import AppKit

class OverlayWindow: NSWindow {
    private var zoneViews: [String: ZoneOverlayView] = [:]

    init() {
        super.init(
            contentRect: .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .stationary]
        ignoresMouseEvents = false  // Need clicks for gold unlock
        hasShadow = false

        contentView = NSView()
        contentView?.wantsLayer = true
    }

    func positionOver(gameWindow: GameWindow) {
        // macOS screen coordinates have origin at bottom-left
        guard let screen = NSScreen.main else { return }
        let screenHeight = screen.frame.height
        let frame = NSRect(
            x: gameWindow.bounds.origin.x,
            y: screenHeight - gameWindow.bounds.origin.y - gameWindow.bounds.height,
            width: gameWindow.bounds.width,
            height: gameWindow.bounds.height
        )
        setFrame(frame, display: true)
    }

    func renderZones(
        zones: [ZoneState],
        gameWindowSize: CGSize,
        onGoldUnlock: @escaping (String, String, Int) -> Void
    ) {
        // Remove views for zones that are no longer locked
        for (id, view) in zoneViews {
            if !zones.contains(where: { $0.zone.id == id && $0.isLocked }) {
                view.removeFromSuperview()
                zoneViews.removeValue(forKey: id)
            }
        }

        guard let contentView = contentView else { return }
        let scaleX = gameWindowSize.width / 1280.0
        let scaleY = gameWindowSize.height / 720.0

        for zoneState in zones {
            guard zoneState.isLocked else { continue }
            let zone = zoneState.zone

            // Calculate position (flip Y for macOS coordinate system)
            let x = zone.x * scaleX
            let y = gameWindowSize.height - (zone.y * scaleY) - (zone.height * scaleY)
            let w = zone.width * scaleX
            let h = zone.height * scaleY
            let frame = NSRect(x: x, y: y, width: w, height: h)

            if let existing = zoneViews[zone.id] {
                existing.frame = frame
                existing.update(zoneState: zoneState)
            } else {
                let view = ZoneOverlayView(
                    frame: frame,
                    zoneState: zoneState,
                    onGoldUnlock: onGoldUnlock
                )
                contentView.addSubview(view)
                zoneViews[zone.id] = view
            }
        }
    }

    func clearZones() {
        for (_, view) in zoneViews { view.removeFromSuperview() }
        zoneViews.removeAll()
    }
}

class ZoneOverlayView: NSView {
    private var zoneState: ZoneState
    private let onGoldUnlock: (String, String, Int) -> Void
    private var unlockButton: NSButton?
    private var lockLabel: NSTextField?

    init(
        frame: NSRect,
        zoneState: ZoneState,
        onGoldUnlock: @escaping (String, String, Int) -> Void
    ) {
        self.zoneState = zoneState
        self.onGoldUnlock = onGoldUnlock
        super.init(frame: frame)
        wantsLayer = true
        setupView()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    private func setupView() {
        layer?.backgroundColor = NSColor(
            red: 0.05, green: 0.1, blue: 0.15, alpha: 0.85
        ).cgColor
        layer?.borderColor = NSColor(
            red: 0.1, green: 0.4, blue: 0.2, alpha: 0.8
        ).cgColor
        layer?.borderWidth = 2
        layer?.cornerRadius = 4

        // Lock text
        let text: String
        if zoneState.zone.unlockMode == "gold" {
            let shared = zoneState.blockUnlockMode == "shared"
            text = shared
                ? "Unlock all for\n\(zoneState.zone.goldCost) gold"
                : "Unlock for\n\(zoneState.zone.goldCost) gold"
        } else {
            let titles = zoneState.requiredTodoTitles
            text = titles.isEmpty ? "Locked" : titles.prefix(3).joined(separator: "\n")
        }

        let label = NSTextField(labelWithString: text)
        label.font = NSFont.systemFont(
            ofSize: max(10, min(14, frame.width * 0.04)),
            weight: .semibold
        )
        label.textColor = NSColor(white: 0.9, alpha: 0.95)
        label.alignment = .center
        label.maximumNumberOfLines = 4
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        lockLabel = label

        // Gold unlock button
        let button = NSButton(
            title: "Unlock for \(zoneState.zone.goldCost) gold",
            target: self,
            action: #selector(goldUnlockClicked)
        )
        button.bezelStyle = .rounded
        button.font = NSFont.systemFont(
            ofSize: max(9, min(12, frame.width * 0.035)),
            weight: .bold
        )
        button.translatesAutoresizingMaskIntoConstraints = false
        button.wantsLayer = true
        button.layer?.backgroundColor = NSColor(
            red: 0.3, green: 0.22, blue: 0.07, alpha: 0.92
        ).cgColor
        button.layer?.cornerRadius = 12
        button.contentTintColor = NSColor(
            red: 0.97, green: 0.87, blue: 0.55, alpha: 1.0
        )
        addSubview(button)
        unlockButton = button

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.topAnchor.constraint(
                equalTo: topAnchor, constant: frame.height * 0.15
            ),
            label.widthAnchor.constraint(
                lessThanOrEqualTo: widthAnchor, constant: -16
            ),

            button.centerXAnchor.constraint(equalTo: centerXAnchor),
            button.topAnchor.constraint(
                equalTo: label.bottomAnchor, constant: 8
            ),
            button.widthAnchor.constraint(
                lessThanOrEqualTo: widthAnchor, constant: -16
            ),
        ])
    }

    func update(zoneState: ZoneState) {
        self.zoneState = zoneState
    }

    @objc private func goldUnlockClicked() {
        onGoldUnlock(zoneState.zone.id, zoneState.zone.name, zoneState.zone.goldCost)
    }
}
