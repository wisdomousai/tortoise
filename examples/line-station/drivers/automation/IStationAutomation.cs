using AgentNative.Driver;

namespace StationAutomation;

/// <summary>What the station software reports, in the contract's terms.</summary>
public sealed record StationStatus(
    string Machine,
    string Alarm,
    string Recipe,
    long Good,
    long Scrap,
    bool LocalControl);

/// <summary>
/// The station software's automation interface as the driver uses it. The COM implementation
/// talks to the vendor's automation server; the simulated one keeps a station in a directory for
/// the demo and the tests. Every call is made on the driver's handler thread.
/// </summary>
public interface IStationAutomation : IDisposable
{
    /// <summary>The station PC's software, reported with every reading the host takes.</summary>
    Device Identify();

    StationStatus Read();

    /// <summary>Asks the station to load a recipe for an order. It may return before the recipe shows.</summary>
    void LoadRecipe(string recipe, string order);
}
