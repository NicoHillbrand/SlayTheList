using System.Text.Json.Serialization;

namespace SlayTheList.OverlayAgent;

public sealed class EventEnvelope
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public OverlayPayload? Payload { get; set; }
}

public sealed class OverlayPayload
{
    [JsonPropertyName("gameWindow")]
    public GameWindowHint GameWindow { get; set; } = new();

    [JsonPropertyName("zones")]
    public List<ZoneState> Zones { get; set; } = [];

    [JsonPropertyName("detectedGameState")]
    public DetectedGameStateInfo? DetectedGameState { get; set; }

    [JsonPropertyName("gameStates")]
    public List<GameStateInfo> GameStates { get; set; } = [];

    [JsonPropertyName("lastUpdatedAt")]
    public string LastUpdatedAt { get; set; } = string.Empty;
}

public sealed class GameWindowHint
{
    [JsonPropertyName("titleHint")]
    public string TitleHint { get; set; } = "Slay the Spire 2";
}

public sealed class ZoneState
{
    [JsonPropertyName("zone")]
    public Zone Zone { get; set; } = new();

    [JsonPropertyName("requiredTodoTitles")]
    public List<string> RequiredTodoTitles { get; set; } = [];

    [JsonPropertyName("isLocked")]
    public bool IsLocked { get; set; }

    [JsonPropertyName("goldUnlockActive")]
    public bool GoldUnlockActive { get; set; }

    [JsonPropertyName("cooldownExpiresAt")]
    public string? CooldownExpiresAt { get; set; }
}

public sealed class Zone
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("x")]
    public double X { get; set; }

    [JsonPropertyName("y")]
    public double Y { get; set; }

    [JsonPropertyName("width")]
    public double Width { get; set; }

    [JsonPropertyName("height")]
    public double Height { get; set; }

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("unlockMode")]
    public string UnlockMode { get; set; } = "todos";
}

public sealed class DetectedGameStateInfo
{
    [JsonPropertyName("gameStateId")]
    public string? GameStateId { get; set; }

    [JsonPropertyName("gameStateName")]
    public string? GameStateName { get; set; }

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    [JsonPropertyName("detectedAt")]
    public string DetectedAt { get; set; } = string.Empty;
}

public sealed class GameStateInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("matchThreshold")]
    public double MatchThreshold { get; set; } = 0.8;

    [JsonPropertyName("alwaysDetect")]
    public bool AlwaysDetect { get; set; }
}

public sealed class TestDetectionResponse
{
    [JsonPropertyName("results")]
    public List<TestDetectionResult> Results { get; set; } = [];
}

public sealed class TestDetectionResult
{
    [JsonPropertyName("gameStateId")]
    public string GameStateId { get; set; } = string.Empty;

    [JsonPropertyName("gameStateName")]
    public string GameStateName { get; set; } = string.Empty;

    [JsonPropertyName("imageId")]
    public string ImageId { get; set; } = string.Empty;

    [JsonPropertyName("filename")]
    public string Filename { get; set; } = string.Empty;

    [JsonPropertyName("ncc")]
    public double Ncc { get; set; }

    [JsonPropertyName("histogram")]
    public double Histogram { get; set; }

    [JsonPropertyName("combined")]
    public double Combined { get; set; }
}
