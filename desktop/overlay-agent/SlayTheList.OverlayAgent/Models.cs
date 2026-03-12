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
}
