using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using Tortoise.Driver;

namespace StationAutomation;

/// <summary>
/// The station software's COM automation server, bound late by ProgID so the driver needs no
/// vendor type library to build. Create it on the driver's handler thread, which is a
/// single-threaded apartment on Windows.
///
/// The member names below are this reference's assumption about the vendor's object model:
/// <c>SerialNumber</c>, <c>Version</c>, <c>Model</c>, <c>MachineState</c>, <c>AlarmText</c>,
/// <c>ActiveRecipe</c>, <c>GoodCount</c>, <c>ScrapCount</c>, <c>LocalControl</c> and
/// <c>LoadRecipe(recipe, order)</c>. Map them to the real server's members here; nothing else in
/// the driver changes.
/// </summary>
public sealed class ComStation : IStationAutomation
{
    private readonly object _server;

    private ComStation(object server) => _server = server;

    public static ComStation Create(string progId)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("COM automation needs Windows");
        var type = Type.GetTypeFromProgID(progId, throwOnError: false)
            ?? throw new InvalidOperationException($"No automation server is registered as {progId}");
        return new ComStation(Activator.CreateInstance(type)
            ?? throw new InvalidOperationException($"{progId} could not be created"));
    }

    private object? Get(string name) =>
        _server.GetType().InvokeMember(name, BindingFlags.GetProperty, null, _server, null,
            CultureInfo.InvariantCulture);

    private string Text(string name) => Convert.ToString(Get(name), CultureInfo.InvariantCulture) ?? "";

    private long Count(string name) => Convert.ToInt64(Get(name), CultureInfo.InvariantCulture);

    public Device Identify() => new(Serial: Text("SerialNumber"), Firmware: Text("Version"), Model: Text("Model"));

    public StationStatus Read() => new(
        Machine: Text("MachineState").ToUpperInvariant(),
        Alarm: Text("AlarmText"),
        Recipe: Text("ActiveRecipe"),
        Good: Count("GoodCount"),
        Scrap: Count("ScrapCount"),
        LocalControl: Convert.ToBoolean(Get("LocalControl"), CultureInfo.InvariantCulture));

    public void LoadRecipe(string recipe, string order) =>
        _server.GetType().InvokeMember("LoadRecipe", BindingFlags.InvokeMethod, null, _server,
            [recipe, order], CultureInfo.InvariantCulture);

    public void Dispose()
    {
        if (OperatingSystem.IsWindows()) Marshal.FinalReleaseComObject(_server);
    }
}
