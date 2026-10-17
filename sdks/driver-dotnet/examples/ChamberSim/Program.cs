// A simulated test chamber, written with the SDK, for the host's conformance tests. It implements
// the reference chamber contract, `chamber` in plugins/connector-driver/src/testing/chamber.ts;
// ChamberContract.cs is generated from it:
//
//   app driver contract chamber --out chamber.json
//   dotnet run --project src/AgentNative.Driver.Stubgen -- chamber.json --namespace ChamberSim -o examples/ChamberSim/ChamberContract.cs
//
// CHAMBER_SIM_DIR holds what a real chamber would keep across a driver restart (its setpoint and
// door), the driver's journal, and test controls: an empty `fail-next` file makes the next action
// fail before it acts, and `crash-next` makes it act and then exit before answering. Applied
// actions are counted in applied.json.
using System.Text.Json;
using AgentNative.Driver;
using ChamberSim;

var home = Environment.GetEnvironmentVariable("CHAMBER_SIM_DIR")
    ?? throw new InvalidOperationException("Set CHAMBER_SIM_DIR");
Directory.CreateDirectory(home);
var equipmentFile = Path.Combine(home, "equipment.json");
var appliedFile = Path.Combine(home, "applied.json");
var initial = new Dictionary<string, object?> { ["setpoint"] = 20, ["door"] = "closed", ["control"] = "remote" };

Dictionary<string, JsonElement> Load(string path, IReadOnlyDictionary<string, object?> fallback) =>
    JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
        File.Exists(path) ? File.ReadAllText(path) : JsonSerializer.Serialize(fallback))!;

void Save(string path, object value) => File.WriteAllText(path, JsonSerializer.Serialize(value));

// Consume a one-shot test control file.
bool Control(string name)
{
    var path = Path.Combine(home, name);
    if (!File.Exists(path)) return false;
    File.Delete(path);
    return true;
}

// Apply to the simulated equipment and count it, then honor crash-next.
void Act(string effectId, string? field = null, object? value = null)
{
    if (field is not null)
    {
        var equipment = Load(equipmentFile, initial);
        equipment[field] = JsonSerializer.SerializeToElement(value);
        Save(equipmentFile, equipment);
    }
    var applied = Load(appliedFile, new Dictionary<string, object?>());
    applied[effectId] = JsonSerializer.SerializeToElement(
        (applied.TryGetValue(effectId, out var count) ? count.GetInt32() : 0) + 1);
    Save(appliedFile, applied);
    if (Control("crash-next")) Environment.Exit(3);
}

void BeforeActing()
{
    if (Control("fail-next")) throw new Refusal(RefusalKind.Transient, "The chamber did not answer");
}

void RefuseMarked(object input)
{
    if (JsonSerializer.Serialize(input).Contains("refuse"))
        throw new Refusal(RefusalKind.Rejected, "Out of range", "OUT_OF_RANGE");
}

using var driver = new Driver(ChamberContract.Document, ChamberContract.Digest, new DriverOptions
{
    Id = "chamber-sim-dotnet",
    Version = "0.1.0",
    Journal = Path.Combine(home, "journal.jsonl"),
});

driver.OnInitialize(_ => [new Device(Serial: "CH-0042", Firmware: "3.1")]);

driver.OnState(_ => new Reading(Load(equipmentFile, initial).ToDictionary(item => item.Key, item => (object?)item.Value)));

driver.Action<SetpointSetInput>("setpoint.set", (input, context) =>
{
    BeforeActing();
    if (input.Setpoint > 300) throw new Refusal(RefusalKind.Rejected, "Out of range", "OUT_OF_RANGE");
    Act(context.EffectId, "setpoint", input.Setpoint);
    return null;
});

driver.Action<CycleStartInput>("cycle.start", (input, context) =>
{
    BeforeActing();
    RefuseMarked(input);
    Act(context.EffectId);
    return new ActionResult(Ref: "cycle-1");
});

driver.Action<LabelPrintInput>("label.print", (input, context) =>
{
    BeforeActing();
    RefuseMarked(input);
    Act(context.EffectId);
    return null;
});

return await driver.RunAsync();
