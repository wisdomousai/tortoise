using System.Text;
using System.Text.Json.Nodes;

namespace Tortoise.Driver;

/// <summary>
/// Reads newline-delimited messages. A line longer than <see cref="MaxLine"/> is dropped whole
/// rather than buffered, so a runaway host cannot exhaust the driver's memory; a final line without
/// a newline is still returned.
/// </summary>
public sealed class LineReader(Stream stream)
{
    public const int MaxLine = 1 << 20;
    private readonly byte[] _chunk = new byte[65536];
    private readonly MemoryStream _line = new();
    private int _start;
    private int _end;
    private bool _oversized;

    /// <summary>The next line without its newline, or null at end of input.</summary>
    public async Task<byte[]?> NextAsync(CancellationToken cancellation = default)
    {
        while (true)
        {
            for (var index = _start; index < _end; index++)
            {
                if (_chunk[index] != (byte)'\n') continue;
                Append(_start, index - _start);
                _start = index + 1;
                if (TakeLine() is { } line) return line;
            }
            Append(_start, _end - _start);
            _start = _end = 0;
            var read = await stream.ReadAsync(_chunk, cancellation);
            if (read == 0)
            {
                var last = _line.Length > 0 || _oversized ? TakeLine() : null;
                return last;
            }
            _end = read;
        }
    }

    private void Append(int offset, int count)
    {
        if (_oversized || count == 0) return;
        if (_line.Length + count > MaxLine)
        {
            _oversized = true;
            _line.SetLength(0);
            return;
        }
        _line.Write(_chunk, offset, count);
    }

    /// <summary>The finished line, or null when it was dropped for its size.</summary>
    private byte[]? TakeLine()
    {
        var dropped = _oversized;
        var line = _line.ToArray();
        _line.SetLength(0);
        _oversized = false;
        if (!dropped) return line;
        Console.Error.WriteLine($"Dropped a line longer than {MaxLine} bytes");
        return null;
    }
}

/// <summary>Writes one JSON-RPC message per line and flushes it at once. Safe from any thread.</summary>
public sealed class LineWriter(Stream stream)
{
    private readonly object _lock = new();
    private bool _closed;

    public void Send(JsonObject message)
    {
        var body = new JsonObject { ["jsonrpc"] = "2.0" };
        foreach (var (key, value) in message) body[key] = value?.DeepClone();
        var bytes = Encoding.UTF8.GetBytes(body.ToJsonString(Json.Compact) + "\n");
        lock (_lock)
        {
            if (_closed) return;
            try
            {
                stream.Write(bytes);
                stream.Flush();
            }
            catch (Exception error) when (error is IOException or ObjectDisposedException)
            {
                // The host is gone; nothing more can be said to it.
                _closed = true;
            }
        }
    }
}
