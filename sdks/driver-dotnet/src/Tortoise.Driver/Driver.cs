using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tortoise.Driver;

public sealed record DriverOptions
{
    /// <summary>The driver's own id, reported at the handshake with every reading.</summary>
    public required string Id { get; init; }
    public required string Version { get; init; }
    /// <summary>Journal file; required when the contract has <c>once</c> actions.</summary>
    public string? Journal { get; init; }
    /// <summary>Run every handler on this thread, such as an STA thread for a COM object.</summary>
    public HandlerThread? HandlerThread { get; init; }
}

/// <summary>
/// One driver for one contract. The host starts it as a child process and speaks JSON-RPC to it
/// over stdin and stdout; this class implements the protocol so a driver author writes only what
/// touches the equipment. Register handlers, then call <see cref="RunAsync"/>.
///
/// What it enforces, whatever the handlers do:
/// - the mode the host sends with each action: monitor-only refuses every action, assist refuses
///   any risk level other than none, and an operator-present action needs presence.confirmedBy;
/// - an action whose deadline passed is refused before it runs;
/// - idempotent and once actions run at most once per effect ID: a repeat returns the recorded
///   outcome and action.lookup returns the journal's record; an effect that started and has no outcome
///   returns uncertain, never unknown;
/// - stdout carries only protocol messages: Console output goes to stderr while the driver runs.
/// </summary>
public sealed class Driver : IDisposable
{
    public const string Protocol = "1";

    private readonly JsonObject _contract;
    private readonly string _digest;
    private readonly DriverOptions _options;
    private readonly Dictionary<string, Func<JsonNode?, ActionContext, Task<ActionResult?>>> _actions = new();
    private readonly ConcurrentDictionary<string, byte> _inflight = new();
    private readonly Dictionary<string, double> _lastEmit = new();
    private readonly object _emitLock = new();
    private Func<JsonObject, Task<IReadOnlyList<Device>>>? _initialize;
    private Func<IReadOnlyList<string>, Task<Reading>>? _state;
    private Func<Task>? _health;
    private Func<Task>? _shutdown;
    private LineWriter? _writer;
    private long _seq;

    public Driver(JsonObject contract, string digest, DriverOptions options)
    {
        _contract = contract;
        _digest = digest;
        _options = options;
        Journal = new Journal(options.Journal);
        var once = Actions.Any(action => action.Value?["delivery"]?.GetValue<string>() == "once");
        if (once && !Journal.Durable)
            throw new ArgumentException("This contract has once actions; set Journal so lookups survive a restart");
    }

    public Journal Journal { get; }
    public string? Session { get; private set; }
    public DriverMode Mode { get; private set; } = DriverMode.MonitorOnly;

    private JsonObject Actions => _contract["actions"] as JsonObject ?? new JsonObject();
    private JsonObject Events => _contract["events"] as JsonObject ?? new JsonObject();
    private JsonObject State => _contract["state"] as JsonObject ?? new JsonObject();

    // Registration -----------------------------------------------------------------------------

    /// <summary>Open the equipment with the host's configuration; return the units found.</summary>
    public void OnInitialize(Func<JsonObject, Task<IReadOnlyList<Device>>> handler) => _initialize = handler;
    public void OnInitialize(Func<JsonObject, IReadOnlyList<Device>> handler) =>
        _initialize = configuration => Task.FromResult(handler(configuration));

    /// <summary>Read the requested fields.</summary>
    public void OnState(Func<IReadOnlyList<string>, Task<Reading>> handler) => _state = handler;
    public void OnState(Func<IReadOnlyList<string>, Reading> handler) =>
        _state = fields => Task.FromResult(handler(fields));

    /// <summary>Throw a <see cref="Refusal"/> when the equipment link is broken; the host restarts the driver.</summary>
    public void OnHealth(Func<Task> handler) => _health = handler;
    public void OnHealth(Action handler) => _health = () => { handler(); return Task.CompletedTask; };

    /// <summary>Release the equipment. Runs on shutdown and when the host goes away.</summary>
    public void OnShutdown(Func<Task> handler) => _shutdown = handler;
    public void OnShutdown(Action handler) => _shutdown = () => { handler(); return Task.CompletedTask; };

    /// <summary>Handle a declared action with its input as the stub generator's record.</summary>
    public void Action<TInput>(string name, Func<TInput, ActionContext, ActionResult?> handler) =>
        Register(name, (input, context) => Task.FromResult(handler(Bind<TInput>(name, input), context)));

    /// <summary>
    /// Handle a declared action asynchronously. Named apart from <c>Action</c> so a handler that
    /// returns null is never ambiguous.
    /// </summary>
    public void ActionAsync<TInput>(string name, Func<TInput, ActionContext, Task<ActionResult?>> handler) =>
        Register(name, (input, context) => handler(Bind<TInput>(name, input), context));

    /// <summary>Handle a declared action with its raw JSON input.</summary>
    public void ActionAsync(string name, Func<JsonNode?, ActionContext, Task<ActionResult?>> handler) =>
        Register(name, handler);

    private void Register(string name, Func<JsonNode?, ActionContext, Task<ActionResult?>> handler)
    {
        if (!Actions.ContainsKey(name)) throw new ArgumentException($"The contract declares no action {name}");
        _actions[name] = handler;
    }

    private static TInput Bind<TInput>(string name, JsonNode? input)
    {
        try
        {
            return input.Deserialize<TInput>()
                ?? throw new Refusal(RefusalKind.Rejected, $"{name} has no input", "INVALID_INPUT");
        }
        catch (JsonException)
        {
            // The host validated the input against the contract; this is a stub out of date.
            throw new Refusal(RefusalKind.Rejected, $"{name} has an input this driver cannot read", "INVALID_INPUT");
        }
    }

    // Events -----------------------------------------------------------------------------------

    /// <summary>
    /// Send a declared event. Safe from any thread. Returns false when dropped by <c>maxRateHz</c>
    /// or before the handshake, when the host has no session to order it in.
    /// </summary>
    public bool Emit(string name, object? payload = null, int? device = null)
    {
        if (Events[name] is not JsonObject declared)
            throw new ArgumentException($"The contract declares no event {name}");
        lock (_emitLock)
        {
            if (Session is null || _writer is null) return false;
            var now = Wire.NowMs();
            var rate = declared["maxRateHz"]?.GetValue<double>();
            // Dropped before it gets a sequence number, so the host sees no gap.
            if (rate is > 0 && _lastEmit.TryGetValue(name, out var last) && now - last < 1000 / rate)
                return false;
            _lastEmit[name] = now;
            var parameters = new JsonObject { ["session"] = Session, ["seq"] = _seq, ["name"] = name, ["at"] = now };
            if (payload is not null) parameters["payload"] = JsonSerializer.SerializeToNode(payload);
            if (device is not null) parameters["device"] = device;
            _seq++;
            _writer.Send(new JsonObject { ["method"] = "event", ["params"] = parameters });
            return true;
        }
    }

    // Requests ---------------------------------------------------------------------------------

    /// <summary>Handle one request. Throws <see cref="Refusal"/> for a classified failure.</summary>
    public async Task<JsonNode> HandleAsync(string method, JsonObject parameters, CancellationToken cancellation = default)
    {
        if (method == "initialize") return await OnHandler(() => InitializeAsync(parameters));
        if (Session is null) throw new Refusal(RefusalKind.Transient, "The driver has not been initialized");
        switch (method)
        {
            case "state.read":
                return await OnHandler(() => ReadStateAsync(parameters));
            case "action.invoke":
                return await InvokeAsync(parameters, cancellation);
            case "action.lookup":
                return Lookup(parameters);
            case "health":
                if (_health is not null) await OnHandler(async () => { await _health(); return 0; });
                return new JsonObject();
            case "shutdown":
                return new JsonObject();
            default:
                throw new ProtocolError(-32601, $"Unknown method {method}");
        }
    }

    private Task<T> OnHandler<T>(Func<Task<T>> work) =>
        _options.HandlerThread is { } thread ? thread.Run(work) : work();

    private async Task<JsonNode> InitializeAsync(JsonObject parameters)
    {
        if (Text(parameters["protocol"]) != Protocol)
            throw new Refusal(RefusalKind.Refused, $"This driver speaks protocol {Protocol}");
        var id = Text(_contract["id"]);
        if (Text(parameters["contract"]?["id"]) != id)
            throw new Refusal(RefusalKind.Refused, $"This driver implements {id}");
        Mode = Wire.Mode(Text(parameters["mode"])) ?? DriverMode.MonitorOnly;
        var configuration = parameters["configuration"] as JsonObject ?? new JsonObject();
        var devices = _initialize is null ? [] : await _initialize(configuration);
        lock (_emitLock)
        {
            Session = Guid.NewGuid().ToString("N");
            _seq = 0;
        }
        return new JsonObject
        {
            ["driver"] = new JsonObject { ["id"] = _options.Id, ["version"] = _options.Version },
            ["contract"] = new JsonObject { ["digest"] = _digest },
            ["session"] = Session,
            ["devices"] = new JsonArray(devices.Select(device => (JsonNode)device.Wire()).ToArray()),
        };
    }

    private async Task<JsonNode> ReadStateAsync(JsonObject parameters)
    {
        if (_state is null) throw new Refusal(RefusalKind.Rejected, "This driver reads no state");
        var fields = (parameters["fields"] as JsonArray ?? [])
            .Select(Text)
            .OfType<string>()
            .Where(State.ContainsKey)
            .ToList();
        var reading = await _state(fields);
        var values = new JsonObject();
        foreach (var field in fields)
            if (reading.Values.TryGetValue(field, out var value))
                values[field] = JsonSerializer.SerializeToNode(value);
        var confidence = new JsonObject();
        foreach (var (field, value) in reading.Confidence ?? new Dictionary<string, double>())
            if (fields.Contains(field)) confidence[field] = Math.Clamp(value, 0, 1);
        return new JsonObject { ["values"] = values, ["confidence"] = confidence, ["at"] = Wire.NowMs() };
    }

    /// <summary>The host's own checks, repeated, so a driver is safe even behind a faulty host.</summary>
    private static void Gate(string name, JsonObject spec, JsonNode? input, DriverMode? mode, double? deadline)
    {
        var risk = Text(spec["risk"]) ?? "operator-present";
        if (mode is null or DriverMode.MonitorOnly)
            throw new Refusal(RefusalKind.Refused, $"This mode does not allow {name}");
        if (mode == DriverMode.Assist && risk != "none")
            throw new Refusal(RefusalKind.Refused, $"{name} needs actuate mode");
        if (risk == "operator-present" && string.IsNullOrEmpty(Text(input?["presence"]?["confirmedBy"])))
            throw new Refusal(RefusalKind.Precondition, $"{name} needs a person at the machine to confirm");
        if (deadline is { } at && Wire.NowMs() > at)
            throw new Refusal(RefusalKind.Transient, $"The deadline for {name} passed before it ran");
    }

    /// <summary>The recorded outcome of an effect that must not run twice, or null to run it.</summary>
    private JsonObject? Replay(string name, JsonObject spec, string effectId)
    {
        // The host reads the equipment back before resending a convergent action; acting again is
        // its decision.
        if (Text(spec["delivery"]) == "convergent") return null;
        var entry = Journal.Get(effectId);
        if (entry is null || entry.Status == JournalStatus.Released) return null;
        if (entry.Action != name)
            throw new Refusal(RefusalKind.Rejected, $"Effect {effectId} was used for {entry.Action}", "EFFECT_REUSED");
        return entry.Status switch
        {
            JournalStatus.Accepted => InvokeResponse(entry.Ref, entry.Result),
            JournalStatus.Rejected => throw new Refusal(RefusalKind.Rejected, entry.Message ?? "Rejected", entry.Code),
            _ => throw new Refusal(RefusalKind.Uncertain, $"The driver stopped while running {name} for this effect"),
        };
    }

    private async Task<JsonNode> InvokeAsync(JsonObject parameters, CancellationToken cancellation)
    {
        var name = Text(parameters["action"]) ?? "";
        var effectId = Text(parameters["effectId"]);
        if (string.IsNullOrEmpty(effectId)) throw new ProtocolError(-32602, "action.invoke needs an effectId");
        if (Actions[name] is not JsonObject spec || !_actions.TryGetValue(name, out var handler))
            throw new Refusal(RefusalKind.Rejected, $"This driver has no action {name}", "UNKNOWN_ACTION");
        var input = parameters["input"];
        var mode = Wire.Mode(Text(parameters["mode"]));
        var deadline = parameters["deadline"] is JsonValue value && value.TryGetValue<double>(out var at) ? at : (double?)null;
        Gate(name, spec, input, mode, deadline);
        if (Replay(name, spec, effectId) is { } replayed) return replayed;
        if (!_inflight.TryAdd(effectId, 0))
            throw new Refusal(RefusalKind.Transient, $"Effect {effectId} is already running");
        Journal.Record(new JournalEntry(effectId, name, JournalStatus.Started));
        ActionResult? outcome;
        try
        {
            var context = new ActionContext(effectId, mode!.Value, deadline, Session ?? "", cancellation);
            outcome = await OnHandler(() => handler(input?.DeepClone(), context));
        }
        catch (Refusal refusal)
        {
            if (refusal.Kind == RefusalKind.Rejected)
                Journal.Record(new JournalEntry(effectId, name, JournalStatus.Rejected,
                    Code: refusal.Code ?? "REJECTED", Message: refusal.Message));
            else if (refusal.Kind is RefusalKind.Precondition or RefusalKind.Transient or RefusalKind.Refused)
                Journal.Record(new JournalEntry(effectId, name, JournalStatus.Released));
            throw;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            // Left as started: the handler may have reached the equipment before it stopped.
            throw;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"{name} failed while acting: {error}");
            throw new Refusal(RefusalKind.Uncertain, $"{name} failed while acting");
        }
        finally
        {
            _inflight.TryRemove(effectId, out _);
        }
        var result = outcome?.Result is null ? null : JsonSerializer.SerializeToNode(outcome.Result);
        Journal.Record(new JournalEntry(effectId, name, JournalStatus.Accepted, outcome?.Ref, result));
        return InvokeResponse(outcome?.Ref, result);
    }

    private JsonNode Lookup(JsonObject parameters)
    {
        var entry = Journal.Get(Text(parameters["effectId"]) ?? "");
        if (entry is null || entry.Status == JournalStatus.Released) return new JsonObject { ["status"] = "unknown" };
        if (entry.Status == JournalStatus.Accepted)
        {
            var response = new JsonObject { ["status"] = "accepted" };
            if (!string.IsNullOrEmpty(entry.Ref)) response["ref"] = entry.Ref;
            return response;
        }
        if (entry.Status == JournalStatus.Rejected)
            return new JsonObject
            {
                ["status"] = "rejected",
                ["code"] = entry.Code ?? "REJECTED",
                ["message"] = entry.Message ?? "Rejected",
            };
        return new JsonObject
        {
            ["status"] = "uncertain",
            ["reason"] = $"The driver stopped while running {entry.Action}",
        };
    }

    private static JsonObject InvokeResponse(string? reference, JsonNode? result)
    {
        var response = new JsonObject();
        if (!string.IsNullOrEmpty(reference)) response["ref"] = Refusal.Truncate(reference, 256);
        if (result is not null) response["result"] = result.DeepClone();
        return response;
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    // Serving ----------------------------------------------------------------------------------

    /// <summary>Handle requests from <paramref name="input"/> until shutdown or end of input.</summary>
    public async Task ServeAsync(Stream input, Stream output)
    {
        _writer = new LineWriter(output);
        var reader = new LineReader(input);
        var running = new ConcurrentDictionary<string, (Task Task, CancellationTokenSource Cancel)>();
        var stopping = false;
        while (!stopping)
        {
            var line = await reader.NextAsync();
            if (line is null) break;
            var message = Parse(line);
            if (message is null)
            {
                Console.Error.WriteLine("Ignored a line that is not a JSON-RPC message");
                continue;
            }
            var (method, parameters, id) = message.Value;
            if (id is null)
            {
                if (method == "$/cancel" && Key(parameters["id"]) is { } target && running.TryGetValue(target, out var request))
                    request.Cancel.Cancel();
                continue;
            }
            stopping = method == "shutdown";
            var key = Key(id)!;
            var cancel = new CancellationTokenSource();
            var task = Task.Run(() => RespondAsync(id, method, parameters, cancel.Token));
            running[key] = (task, cancel);
            _ = task.ContinueWith(_ => { running.TryRemove(key, out var done); done.Cancel?.Dispose(); }, TaskScheduler.Default);
        }
        await Task.WhenAll(running.Values.Select(request => request.Task));
        if (_shutdown is not null)
            try
            {
                await OnHandler(async () => { await _shutdown(); return 0; });
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"Shutdown failed: {error}");
            }
        Journal.Dispose();
    }

    private async Task RespondAsync(JsonNode id, string method, JsonObject parameters, CancellationToken cancellation)
    {
        JsonObject Error(int code, string message, JsonObject data) => new()
        {
            ["id"] = id.DeepClone(),
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["data"] = data },
        };
        JsonObject reply;
        try
        {
            reply = new JsonObject { ["id"] = id.DeepClone(), ["result"] = await HandleAsync(method, parameters, cancellation) };
        }
        catch (Refusal refusal)
        {
            var data = new JsonObject { ["kind"] = Wire.Name(refusal.Kind) };
            if (refusal.Code is not null) data["code"] = refusal.Code;
            reply = Error(-32000, refusal.Message, data);
        }
        catch (ProtocolError error)
        {
            reply = Error(error.Code, error.Message, new JsonObject { ["kind"] = "rejected" });
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            reply = Error(-32800, $"{method} was cancelled", new JsonObject { ["kind"] = "transient" });
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"{method} failed: {error}");
            reply = Error(-32603, $"{method} failed", new JsonObject { ["kind"] = "transient" });
        }
        _writer!.Send(reply);
    }

    /// <summary>Serve on stdin and stdout. Console output goes to stderr from here on.</summary>
    public async Task<int> RunAsync()
    {
        var protocol = Console.OpenStandardOutput();
        Console.SetOut(Console.Error);
        await ServeAsync(Console.OpenStandardInput(), protocol);
        return 0;
    }

    public void Dispose() => Journal.Dispose();

    private static (string Method, JsonObject Parameters, JsonNode? Id)? Parse(byte[] line)
    {
        try
        {
            if (JsonNode.Parse(line) is not JsonObject message || Text(message["jsonrpc"]) != "2.0") return null;
            if (Text(message["method"]) is not { } method) return null;
            var parameters = message["params"] ?? new JsonObject();
            if (parameters is not JsonObject body) return null;
            return (method, (JsonObject)body.DeepClone(), message["id"]?.DeepClone());
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A request id as a dictionary key: numbers and strings stay distinct.</summary>
    private static string? Key(JsonNode? id) => id?.ToJsonString();
}

internal sealed class ProtocolError(int code, string message) : Exception(message)
{
    public int Code { get; } = code;
}
