using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AgentNative.Driver;

/// <summary>Where an effect stands. <c>Released</c>: refused before acting, so it may run again.</summary>
public enum JournalStatus
{
    Started,
    Released,
    Accepted,
    Rejected,
}

public sealed record JournalEntry(
    string EffectId,
    string Action,
    JournalStatus Status,
    string? Ref = null,
    JsonNode? Result = null,
    string? Code = null,
    string? Message = null);

/// <summary>
/// What the driver did per effect ID, so retries and lookups survive a driver restart. The host
/// may send an effect again after a lost reply, and asks <c>action.lookup</c> before resending a
/// <c>once</c> action; both responses have to come from what the equipment was told, not from memory
/// a crash erased. <c>Started</c> is written and flushed to disk before the driver acts, and the
/// outcome after. An effect that started and has no outcome reads as uncertain.
///
/// The file format is the Python SDK's: one JSON object per line with snake_case keys, so a
/// journal can be inspected with the same tools whichever SDK wrote it.
/// </summary>
public sealed class Journal : IDisposable
{
    private readonly Dictionary<string, JournalEntry> _entries = new();
    private readonly object _lock = new();
    private FileStream? _file;

    public Journal(string? path = null)
    {
        if (path is null) return;
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        if (File.Exists(full))
            foreach (var line in File.ReadAllLines(full, Encoding.UTF8))
            {
                // A torn last line from a crash mid-write is skipped: its effect stays started,
                // which reads as uncertain, the safe result.
                var entry = Parse(line);
                if (entry is not null) _entries[entry.EffectId] = entry;
            }
        _file = new FileStream(full, FileMode.Append, FileAccess.Write, FileShare.Read);
    }

    public bool Durable => _file is not null;

    public JournalEntry? Get(string effectId)
    {
        lock (_lock) return _entries.GetValueOrDefault(effectId);
    }

    public void Record(JournalEntry entry)
    {
        lock (_lock)
        {
            _entries[entry.EffectId] = entry;
            if (_file is null) return;
            var line = Encoding.UTF8.GetBytes(Format(entry) + "\n");
            _file.Write(line);
            // Flushed through to the disk before the driver moves on.
            _file.Flush(flushToDisk: true);
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _file?.Dispose();
            _file = null;
        }
    }

    private static string StatusName(JournalStatus status) => status.ToString().ToLowerInvariant();

    private static string Format(JournalEntry entry)
    {
        var line = new JsonObject
        {
            ["effect_id"] = entry.EffectId,
            ["action"] = entry.Action,
            ["status"] = StatusName(entry.Status),
        };
        if (entry.Ref is not null) line["ref"] = entry.Ref;
        if (entry.Result is not null) line["result"] = entry.Result.DeepClone();
        if (entry.Code is not null) line["code"] = entry.Code;
        if (entry.Message is not null) line["message"] = entry.Message;
        return line.ToJsonString(Json.Compact);
    }

    private static JournalEntry? Parse(string line)
    {
        try
        {
            if (JsonNode.Parse(line) is not JsonObject raw) return null;
            var status = raw["status"]?.GetValue<string>() switch
            {
                "started" => JournalStatus.Started,
                "released" => JournalStatus.Released,
                "accepted" => JournalStatus.Accepted,
                "rejected" => JournalStatus.Rejected,
                _ => (JournalStatus?)null,
            };
            var effectId = raw["effect_id"]?.GetValue<string>();
            var action = raw["action"]?.GetValue<string>();
            if (status is null || effectId is null || action is null) return null;
            return new JournalEntry(
                effectId,
                action,
                status.Value,
                raw["ref"]?.GetValue<string>(),
                raw["result"]?.DeepClone(),
                raw["code"]?.GetValue<string>(),
                raw["message"]?.GetValue<string>());
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }
}

internal static class Json
{
    /// <summary>Compact output that keeps non-ASCII text as is, like the host and the Python SDK.</summary>
    public static readonly JsonSerializerOptions Compact = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };
}
