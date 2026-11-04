using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Tortoise.Driver;

/// <summary>
/// The contract file the host writes with <c>app driver contract &lt;id&gt; --out file.json</c>:
/// <c>{"digest": ..., "document": ...}</c>. The digest is the SHA-256 of the document's canonical
/// JSON, computed here exactly as the host computes it, so a hand-edited contract is refused.
/// </summary>
public static class ContractFile
{
    /// <summary>The document and its digest. Throws <see cref="InvalidDataException"/> when they disagree.</summary>
    public static (JsonElement Document, string Digest) Read(string json)
    {
        using var file = JsonDocument.Parse(json);
        if (!file.RootElement.TryGetProperty("document", out var document) || document.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("The contract file has no document");
        var digest = Digest(document);
        var stated = file.RootElement.TryGetProperty("digest", out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
        if (stated != digest)
            throw new InvalidDataException("The contract file's digest does not match its document; regenerate it");
        return (document.Clone(), digest);
    }

    public static string Digest(JsonElement document) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(document))));

    /// <summary>
    /// The host's canonical JSON: <c>JSON.stringify</c> with object keys sorted by UTF-16 code
    /// unit and no whitespace. Numbers keep the text they were read with, which is the host's
    /// own formatting because the host wrote the file.
    /// </summary>
    public static string Canonical(JsonElement value)
    {
        var text = new StringBuilder();
        Write(value, text);
        return text.ToString();
    }

    private static void Write(JsonElement value, StringBuilder text)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                text.Append('{');
                var first = true;
                foreach (var property in value.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
                {
                    if (!first) text.Append(',');
                    first = false;
                    Quote(property.Name, text);
                    text.Append(':');
                    Write(property.Value, text);
                }
                text.Append('}');
                break;
            case JsonValueKind.Array:
                text.Append('[');
                var index = 0;
                foreach (var item in value.EnumerateArray())
                {
                    if (index++ > 0) text.Append(',');
                    Write(item, text);
                }
                text.Append(']');
                break;
            case JsonValueKind.String:
                Quote(value.GetString()!, text);
                break;
            default:
                // Numbers, true, false and null as written.
                text.Append(value.GetRawText());
                break;
        }
    }

    /// <summary>A JSON string escaped as <c>JSON.stringify</c> escapes it; other text stays as is.</summary>
    public static void Quote(string value, StringBuilder text)
    {
        text.Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var c = value[index];
            switch (c)
            {
                case '"': text.Append("\\\""); break;
                case '\\': text.Append("\\\\"); break;
                case '\b': text.Append("\\b"); break;
                case '\f': text.Append("\\f"); break;
                case '\n': text.Append("\\n"); break;
                case '\r': text.Append("\\r"); break;
                case '\t': text.Append("\\t"); break;
                default:
                    var lone = char.IsHighSurrogate(c)
                        ? index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1])
                        : char.IsLowSurrogate(c) && (index == 0 || !char.IsHighSurrogate(value[index - 1]));
                    if (c < 0x20 || lone) text.Append($"\\u{(int)c:x4}");
                    else text.Append(c);
                    break;
            }
        }
        text.Append('"');
    }
}
