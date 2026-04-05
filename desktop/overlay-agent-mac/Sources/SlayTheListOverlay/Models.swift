import Foundation

struct EventEnvelope: Codable {
    let type: String?
    let payload: OverlayPayload?
}

struct OverlayPayload: Codable {
    let gameWindow: GameWindowHint?
    let zones: [ZoneState]
    let detectedGameState: DetectedGameStateInfo?
    let gameStates: [GameStateInfo]
    let lastUpdatedAt: String?
    let showDetectionIndicator: Bool?
}

struct GameWindowHint: Codable {
    let titleContains: String?
    let processName: String?
}

struct ZoneState: Codable {
    let zone: Zone
    let requiredTodoTitles: [String]
    let isLocked: Bool
    let goldUnlockActive: Bool
    let cooldownExpiresAt: String?
    let blockId: String?
    let blockUnlockMode: String?
}

struct Zone: Codable {
    let id: String
    let name: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let locked: Bool
    let unlockMode: String
    let goldCost: Int
}

struct GameStateInfo: Codable {
    let id: String
    let name: String
    let enabled: Bool
    let matchThreshold: Double
    let alwaysDetect: Bool
}

struct DetectedGameStateInfo: Codable {
    let gameStateId: String?
    let gameStateName: String?
    let confidence: Double
    let detectedAt: String?
}

struct TestDetectionResponse: Codable {
    let results: [TestDetectionResult]
}

struct TestDetectionResult: Codable {
    let gameStateId: String
    let gameStateName: String
    let imageId: String
    let filename: String
    let ncc: Double
    let histogram: Double
    let combined: Double
}
