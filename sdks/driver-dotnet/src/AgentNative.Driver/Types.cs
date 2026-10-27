using System.Text.Json.Nodes;

namespace AgentNative.Driver;

/// <summary>The bridge mode the host sends with each action.</summary>
public enum DriverMode
{
    MonitorOnly,
    Assist,
    Actuate,
}

/// <summary>How a failed request is classified on the wire.</summary>
public enum RefusalKind
{
    /// <summary>The equipment refused the request; retrying will not help.</summary>
    Rejected,
    /// <summary>The equipment is not in a state to do it now.</summary>
    Precondition,
    /// <summary>Nothing was done, and a retry may succeed.</summary>
    Transient,
    /// <summary>The equipment may have acted and the driver cannot tell. A person decides.</summary>
    Uncertain,
    /// <summary>The mode or the driver's own rules do not allow it.</summary>
    Refused,
}

/// <summary>
/// A response that is not a result. Throw it from a handler to classify a failure. Any other
/// exception thrown while acting reads as <see cref="RefusalKind.Uncertain"/>, because the driver
/// cannot know how far the equipment got; throw a transient refusal when you know nothing happened.
/// </summary>
public sealed class Refusal(RefusalKind kind, string message, string? code = null)
    : Exception(Truncate(message, 500))
{
    public RefusalKind Kind { get; } = kind;
    /// <summary>Your business code, shown to the person who reviews a rejected effect.</summary>
    public string? Code { get; } = code is null ? null : Truncate(code, 64);

    internal static string Truncate(string text, int length) =>
        text.Length <= length ? text : text[..length];
}

/// <summary>The unit the driver talks to, recorded with every reading the host takes from it.</summary>
public sealed record Device(string? Serial = null, string? Firmware = null, string? Model = null)
{
    internal JsonObject Wire()
    {
        var wire = new JsonObject();
        if (!string.IsNullOrEmpty(Serial)) wire["serial"] = Serial;
        if (!string.IsNullOrEmpty(Firmware)) wire["firmware"] = Firmware;
        if (!string.IsNullOrEmpty(Model)) wire["model"] = Model;
        return wire;
    }
}

/// <summary>State values, with the instrument's own confidence (0 to 1) where it reports one.</summary>
public sealed record Reading(
    IReadOnlyDictionary<string, object?> Values,
    IReadOnlyDictionary<string, double>? Confidence = null);

/// <summary>What the driver knows about the action it runs.</summary>
/// <param name="EffectId">The outbox effect; the same ID is sent again after a lost reply.</param>
/// <param name="Mode">The bridge mode the host sent with this action.</param>
/// <param name="Deadline">Milliseconds since the epoch; the host stops waiting then.</param>
/// <param name="Session">The session the handshake started.</param>
/// <param name="Cancellation">Cancelled when the host sends <c>$/cancel</c> for this request.</param>
public sealed record ActionContext(
    string EffectId,
    DriverMode Mode,
    double? Deadline,
    string Session,
    CancellationToken Cancellation);

/// <summary>What an action handler may return besides null: the equipment's reference and a result.</summary>
public sealed record ActionResult(string? Ref = null, object? Result = null);

internal static class Wire
{
    public static string Name(DriverMode mode) => mode switch
    {
        DriverMode.MonitorOnly => "monitor-only",
        DriverMode.Assist => "assist",
        _ => "actuate",
    };

    public static DriverMode? Mode(string? name) => name switch
    {
        "monitor-only" => DriverMode.MonitorOnly,
        "assist" => DriverMode.Assist,
        "actuate" => DriverMode.Actuate,
        _ => null,
    };

    public static string Name(RefusalKind kind) => kind switch
    {
        RefusalKind.Rejected => "rejected",
        RefusalKind.Precondition => "precondition",
        RefusalKind.Transient => "transient",
        RefusalKind.Uncertain => "uncertain",
        _ => "refused",
    };

    public static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
