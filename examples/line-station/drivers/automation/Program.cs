// The station automation driver: reaches the line station's software through its automation
// interface instead of its screen. It implements the `station-automation` contract in
// examples/line-station/contracts/automation.ts; StationAutomationContract.cs is generated from it:
//
//   app driver contract station-automation --out station-automation.json
//   dotnet run --project sdks/driver-dotnet/src/AgentNative.Driver.Stubgen -- station-automation.json \
//     --namespace StationAutomation -o examples/line-station/drivers/automation/StationAutomationContract.cs
//
// Configuration comes from the environment the site policy binds for the
// `station-automation-driver` process:
// - STATION_AUTOMATION_PROGID: the station software's COM automation server (Windows).
// - STATION_AUTOMATION_SIM_DIR: a simulated station kept in that directory instead (demo and tests).
using AgentNative.Driver;
using StationAutomation;

var simulation = Environment.GetEnvironmentVariable("STATION_AUTOMATION_SIM_DIR");
var progId = Environment.GetEnvironmentVariable("STATION_AUTOMATION_PROGID");
if (string.IsNullOrEmpty(simulation) && string.IsNullOrEmpty(progId))
{
    Console.Error.WriteLine("Set STATION_AUTOMATION_PROGID, or STATION_AUTOMATION_SIM_DIR for a simulated station");
    return 2;
}

// Every handler runs on this thread, so the COM object is created and called in one apartment.
using var thread = new HandlerThread("station automation");
using var driver = new Driver(StationAutomationContract.Document, StationAutomationContract.Digest, new DriverOptions
{
    Id = "station-automation-dotnet",
    Version = "1.0.0",
    HandlerThread = thread,
});
IStationAutomation? station = null;

IStationAutomation Station() =>
    station ?? throw new Refusal(RefusalKind.Transient, "The station software is not connected");

driver.OnInitialize(_ =>
{
    station?.Dispose();
    station = string.IsNullOrEmpty(simulation) ? ComStation.Create(progId!) : new SimulatedStation(simulation);
    return [station.Identify()];
});

driver.OnState(_ =>
{
    var status = Station().Read();
    return new Reading(new Dictionary<string, object?>
    {
        ["machine"] = status.Machine,
        ["alarm"] = status.Alarm,
        ["recipe"] = status.Recipe,
        ["good"] = status.Good,
        ["scrap"] = status.Scrap,
        ["control"] = status.LocalControl ? "local" : "remote",
    });
});

driver.OnHealth(() => Station().Read());

driver.OnShutdown(() =>
{
    station?.Dispose();
    station = null;
});

// The host checks the preconditions and reads the recipe back; the station is asked again here,
// right before acting, because someone at the machine may have moved it since the host's read.
driver.Action<RecipeLoadInput>("recipe.load", (input, _) =>
{
    var target = Station();
    StationStatus status;
    try
    {
        status = target.Read();
    }
    catch (Exception error) when (error is not Refusal)
    {
        throw new Refusal(RefusalKind.Transient, $"The station could not be read: {error.Message}");
    }
    if (status.LocalControl)
        throw new Refusal(RefusalKind.Precondition, "The station is under local control", "LOCAL_CONTROL");
    if (status.Machine != "STOPPED")
        throw new Refusal(RefusalKind.Precondition, "The machine is not stopped", "NOT_STOPPED");
    // Anything thrown from here on reads as uncertain: the station may have taken the request.
    target.LoadRecipe(input.Recipe, input.Order);
    return null;
});

return await driver.RunAsync();
