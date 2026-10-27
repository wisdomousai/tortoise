using System.Text.Json;
using System.Text.Json.Serialization;
using AgentNative.Driver;

namespace StationAutomation;

/// <summary>
/// A station kept in a directory, for the demo and the tests. station.json holds what the station
/// software would report and survives a driver restart; the tests edit it to move the machine.
/// Test controls: an empty <c>fail-next</c> file makes the next load fail before it acts,
/// <c>crash-next</c> makes it act and then exit before responding, and while <c>jam</c> exists a
/// load is taken but the recipe does not change.
/// </summary>
public sealed class SimulatedStation(string home) : IStationAutomation
{
    private sealed record State(
        [property: JsonPropertyName("machine")] string Machine = "STOPPED",
        [property: JsonPropertyName("alarm")] string Alarm = "",
        [property: JsonPropertyName("recipe")] string Recipe = "R-500",
        [property: JsonPropertyName("good")] long Good = 0,
        [property: JsonPropertyName("scrap")] long Scrap = 0,
        [property: JsonPropertyName("control")] string Control = "remote",
        [property: JsonPropertyName("loads")] int Loads = 0);

    private string StateFile => Path.Combine(home, "station.json");

    private State Load() =>
        File.Exists(StateFile) ? JsonSerializer.Deserialize<State>(File.ReadAllText(StateFile)) ?? new() : new();

    private void Save(State state) => File.WriteAllText(StateFile, JsonSerializer.Serialize(state));

    // Consume a one-shot test control file.
    private bool Control(string name)
    {
        var path = Path.Combine(home, name);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    public Device Identify()
    {
        Directory.CreateDirectory(home);
        if (!File.Exists(StateFile)) Save(new State());
        return new Device(Serial: "FILLER-1", Firmware: "4.2", Model: "Simulated station");
    }

    public StationStatus Read()
    {
        var state = Load();
        return new StationStatus(state.Machine, state.Alarm, state.Recipe, state.Good, state.Scrap,
            state.Control == "local");
    }

    public void LoadRecipe(string recipe, string order)
    {
        if (Control("fail-next")) throw new Refusal(RefusalKind.Transient, "The station did not respond");
        var state = Load();
        var jammed = File.Exists(Path.Combine(home, "jam"));
        Save(state with { Recipe = jammed ? state.Recipe : recipe, Loads = state.Loads + 1 });
        if (Control("crash-next")) Environment.Exit(3);
    }

    public void Dispose() { }
}
