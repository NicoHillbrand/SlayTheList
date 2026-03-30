import AppKit
import Foundation

class OverlayController: NSObject, URLSessionWebSocketDelegate {
    private let apiBaseUrl: String
    private let wsUrl: String

    private var overlayWindow: OverlayWindow?
    private var indicatorWindow: IndicatorWindow?
    private var lastOverlayState: OverlayPayload?
    private var gameWindow: GameWindow?
    private var webSocketTask: URLSessionWebSocketTask?
    private var syncTimer: Timer?
    private var detectionTimer: Timer?
    private var isGameFocused = false
    private var isDetecting = false

    override init() {
        let wsEnv = ProcessInfo.processInfo.environment["SLAYTHELIST_WS_URL"]
            ?? "ws://localhost:8788/ws"
        self.wsUrl = wsEnv
        self.apiBaseUrl = wsEnv
            .replacingOccurrences(of: "ws://", with: "http://")
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "/ws", with: "")
        super.init()
    }

    func start() {
        overlayWindow = OverlayWindow()
        indicatorWindow = IndicatorWindow()
        indicatorWindow?.orderFront(nil)

        connectWebSocket()

        // Sync overlay position every 250ms
        syncTimer = Timer.scheduledTimer(
            withTimeInterval: 0.25, repeats: true
        ) { [weak self] _ in
            self?.syncOverlay()
        }

        // Detection loop every 200ms (only runs when needed)
        detectionTimer = Timer.scheduledTimer(
            withTimeInterval: 0.2, repeats: true
        ) { [weak self] _ in
            self?.runDetectionIfNeeded()
        }

        print("[SlayTheList] Overlay agent started")
        print("[SlayTheList] WebSocket: \(wsUrl)")
        print("[SlayTheList] API: \(apiBaseUrl)")
    }

    // MARK: - WebSocket

    private func connectWebSocket() {
        let session = URLSession(
            configuration: .default,
            delegate: self,
            delegateQueue: .main
        )
        guard let url = URL(string: wsUrl) else {
            print("[SlayTheList] Invalid WebSocket URL: \(wsUrl)")
            return
        }
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
        print("[SlayTheList] WebSocket connecting...")
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self?.handleMessage(text)
                }
                self?.receiveMessage()
            case .failure(let error):
                print("[SlayTheList] WebSocket error: \(error.localizedDescription)")
                // Reconnect after delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                    self?.connectWebSocket()
                }
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        print("[SlayTheList] WebSocket connected")
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        print("[SlayTheList] WebSocket closed (code: \(closeCode.rawValue))")
        // Reconnect after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.connectWebSocket()
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(EventEnvelope.self, from: data) else {
            return
        }

        if envelope.type == "overlay_state", let payload = envelope.payload {
            lastOverlayState = payload
            renderLockedZones()
        }
    }

    // MARK: - Overlay Sync

    private func syncOverlay() {
        let titleHint = lastOverlayState?.gameWindow?.titleContains
        gameWindow = findGameWindow(titleContains: titleHint)
        isGameFocused = isGameWindowFocused(gameWindow: gameWindow)

        if let gw = gameWindow, isGameFocused || hasAlwaysDetectState() {
            overlayWindow?.positionOver(gameWindow: gw)
            if overlayWindow?.isVisible == false {
                overlayWindow?.orderFront(nil)
            }
        } else {
            overlayWindow?.orderOut(nil)
            overlayWindow?.clearZones()
        }

        updateIndicator()
    }

    private func hasAlwaysDetectState() -> Bool {
        lastOverlayState?.gameStates.contains(where: {
            $0.enabled && $0.alwaysDetect
        }) ?? false
    }

    // MARK: - Detection

    private func runDetectionIfNeeded() {
        guard !isDetecting else { return }
        guard let state = lastOverlayState else { return }
        let enabledStates = state.gameStates.filter { $0.enabled }
        guard !enabledStates.isEmpty else { return }

        let alwaysDetect = hasAlwaysDetectState()
        guard isGameFocused || alwaysDetect else { return }

        let useFullScreen = alwaysDetect && !isGameFocused

        isDetecting = true
        Task {
            await runSingleDetection(useFullScreen: useFullScreen)
            await MainActor.run { isDetecting = false }
        }
    }

    private func runSingleDetection(useFullScreen: Bool) async {
        let imageData: Data?
        if useFullScreen {
            imageData = captureScreen()
        } else if let gw = gameWindow {
            imageData = captureWindow(gw.windowNumber)
        } else {
            return
        }

        guard let png = imageData else { return }
        let base64 = png.base64EncodedString()

        guard let url = URL(
            string: "\(apiBaseUrl)/api/game-states/test-detection"
        ) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["image": base64])

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(
                TestDetectionResponse.self, from: data
            )

            guard let best = response.results.first else {
                await setDetectedState(gameStateId: nil, confidence: 0)
                return
            }

            // Find threshold for this game state
            let threshold = lastOverlayState?.gameStates
                .first(where: { $0.id == best.gameStateId })?
                .matchThreshold ?? 0.8

            if best.combined >= threshold {
                await setDetectedState(
                    gameStateId: best.gameStateId,
                    confidence: best.combined
                )
            } else {
                await setDetectedState(gameStateId: nil, confidence: 0)
            }
        } catch {
            // Silently fail - detection will retry on next timer tick
        }
    }

    private func setDetectedState(
        gameStateId: String?, confidence: Double
    ) async {
        guard let url = URL(
            string: "\(apiBaseUrl)/api/detected-game-state"
        ) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct DetectedStateBody: Codable {
            let gameStateId: String?
            let confidence: Double
        }
        request.httpBody = try? JSONEncoder().encode(
            DetectedStateBody(gameStateId: gameStateId, confidence: confidence)
        )
        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Rendering

    private func renderLockedZones() {
        guard let state = lastOverlayState, let gw = gameWindow else { return }
        overlayWindow?.renderZones(
            zones: state.zones,
            gameWindowSize: gw.bounds.size,
            onGoldUnlock: { [weak self] zoneId, zoneName, goldCost in
                self?.unlockZoneWithGold(
                    zoneId: zoneId, zoneName: zoneName, goldCost: goldCost
                )
            }
        )
    }

    // MARK: - Gold Unlock

    private func unlockZoneWithGold(
        zoneId: String, zoneName: String, goldCost: Int
    ) {
        Task {
            guard let url = URL(
                string: "\(apiBaseUrl)/api/zones/\(zoneId)/gold-unlock"
            ) else { return }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(
                "application/json", forHTTPHeaderField: "Content-Type"
            )
            request.httpBody = "{}".data(using: .utf8)

            do {
                let (_, response) = try await URLSession.shared.data(
                    for: request
                )
                if let httpResponse = response as? HTTPURLResponse,
                    httpResponse.statusCode == 200
                {
                    NSSound.beep()
                    print(
                        "[SlayTheList] Gold unlock: \(zoneName) (-\(goldCost)g)"
                    )
                }
            } catch {
                print(
                    "[SlayTheList] Gold unlock failed: \(error.localizedDescription)"
                )
            }
        }
    }

    // MARK: - Indicator

    private func updateIndicator() {
        guard let indicator = indicatorWindow else { return }

        let showIndicator = lastOverlayState?.showDetectionIndicator ?? true
        if !showIndicator {
            indicator.orderOut(nil)
            return
        }
        if !indicator.isVisible { indicator.orderFront(nil) }

        let detected = lastOverlayState?.detectedGameState
        let text: String

        if !hasAlwaysDetectState() && !isGameFocused {
            text = "Detection paused"
        } else if let d = detected, let name = d.gameStateName,
            !name.isEmpty, d.gameStateId != nil
        {
            let confidence = Int(d.confidence * 100)
            text = "Detected: \(name) (\(confidence)%)"
        } else {
            text = "Detecting: None"
        }

        indicator.update(text: text)
    }
}
