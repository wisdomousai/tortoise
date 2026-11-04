using System.IO.Pipelines;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tortoise.Driver.Tests;

[AttributeUsage(AttributeTargets.Class)]
internal sealed class TestsAttribute : Attribute;

internal static class Check
{
    public static void Equal<T>(T expected, T actual, string what = "value")
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new Exception($"{what}: expected {expected}, got {actual}");
    }

    public static void Json(string expected, JsonNode? actual) =>
        Equal(JsonNode.Parse(expected)!.ToJsonString(), actual?.ToJsonString() ?? "null", "JSON");

    public static void True(bool condition, string what)
    {
        if (!condition) throw new Exception(what);
    }

    public static async Task<Refusal> Refuses(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Refusal refusal)
        {
            return refusal;
        }
        throw new Exception("expected a refusal");
    }
}

/// <summary>A press: one action per delivery mode, read with the same rules as the Python SDK's tests.</summary>
internal sealed class Press : IDisposable
{
    public const string Contract = """
        {"protocol":"1","id":"press","version":"1.0.0","title":"Press",
         "state":{"force":{"type":"number"},"door":{"type":"enum","options":["open","closed"]}},
         "actions":{
           "stamp":{"title":"Stamp","delivery":"once","risk":"operator-present","timeoutMs":1000,
             "input":{"type":"object","properties":{"part":{"type":"string"},
               "presence":{"type":"object","properties":{"confirmedBy":{"type":"string"}},"required":["confirmedBy"]}},
               "required":["part"]}},
           "label":{"title":"Label","delivery":"idempotent","risk":"none","timeoutMs":1000,
             "input":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}},
           "force.set":{"title":"Set force","delivery":"convergent","risk":"low","timeoutMs":1000,
             "input":{"type":"object","properties":{"force":{"type":"number"}},"required":["force"]},
             "readback":[{"field":"force","equals":"$input.force"}]}},
         "events":{"reading":{"kind":"telemetry","maxRateHz":1}},
         "lookup":true}
        """;

    public static readonly string Digest = ContractFile.Digest(JsonDocument.Parse(Contract).RootElement);

    private readonly string _directory = Directory.CreateTempSubdirectory("driver-dotnet-").FullName;
    public List<string> Applied { get; } = [];
    public Driver Driver { get; private set; }

    public Press() => Driver = Make();

    public string JournalPath => Path.Combine(_directory, "journal.jsonl");

    public Driver Make(HandlerThread? thread = null)
    {
        var driver = new Driver((JsonObject)JsonNode.Parse(Contract)!, Digest,
            new DriverOptions { Id = "press", Version = "1", Journal = JournalPath, HandlerThread = thread });
        driver.OnInitialize(_ => [new Device(Serial: "P-1")]);
        driver.OnState(_ => new Reading(new Dictionary<string, object?> { ["force"] = 3.5, ["door"] = "closed", ["noise"] = 1 }));
        driver.ActionAsync("stamp", (input, context) =>
        {
            var part = input!["part"]!.GetValue<string>();
            if (part == "bad") throw new Refusal(RefusalKind.Rejected, "No such part", "PART");
            if (part == "crash") throw new InvalidOperationException("servo fault");
            Applied.Add(context.EffectId);
            return Task.FromResult<ActionResult?>(new ActionResult(Ref: $"stamp-{Applied.Count}"));
        });
        driver.ActionAsync<LabelInput>("label", async (input, context) =>
        {
            await Task.Yield();
            if (input.Text == "busy") throw new Refusal(RefusalKind.Transient, "Printer busy");
            Applied.Add(context.EffectId);
            return null;
        });
        driver.Action<ForceInput>("force.set", (_, context) =>
        {
            Applied.Add(context.EffectId);
            return null;
        });
        return driver;
    }

    public Driver Restart()
    {
        Driver.Dispose();
        return Driver = Make();
    }

    public static Task<JsonNode> Initialize(Driver driver) =>
        driver.HandleAsync("initialize", Params("""{"protocol":"1","contract":{"id":"press"}}"""));

    public Task<JsonNode> Invoke(string action, string input, string effectId = "e1", string mode = "actuate", Driver? driver = null) =>
        (driver ?? Driver).HandleAsync("action.invoke", Params(
            $$"""{"action":"{{action}}","input":{{input}},"effectId":"{{effectId}}","mode":"{{mode}}"}"""));

    public Task<JsonNode> Lookup(string effectId) =>
        Driver.HandleAsync("action.lookup", Params($$"""{"effectId":"{{effectId}}"}"""));

    public static JsonObject Params(string json) => (JsonObject)JsonNode.Parse(json)!;

    public void Dispose()
    {
        Driver.Dispose();
        Directory.Delete(_directory, recursive: true);
    }

    public sealed record LabelInput([property: System.Text.Json.Serialization.JsonPropertyName("text")] string Text);
    public sealed record ForceInput([property: System.Text.Json.Serialization.JsonPropertyName("force")] double Force);
}

[Tests]
internal static class DriverTests
{
    private const string Confirmed = """{"confirmedBy":"ina"}""";

    private static async Task<Press> Ready()
    {
        var press = new Press();
        await Press.Initialize(press.Driver);
        return press;
    }

    public static async Task HandshakeReportsUnitsAndRefusesAnotherContract()
    {
        using var press = new Press();
        var result = await Press.Initialize(press.Driver);
        Check.Json("""[{"serial":"P-1"}]""", result["devices"]);
        Check.Json($$"""{"digest":"{{Press.Digest}}"}""", result["contract"]);
        var refusal = await Check.Refuses(() => press.Driver.HandleAsync("initialize",
            Press.Params("""{"protocol":"1","contract":{"id":"oven"}}""")));
        Check.Equal(RefusalKind.Refused, refusal.Kind);
    }

    public static async Task RequestsBeforeTheHandshakeAreTransient()
    {
        using var press = new Press();
        var refusal = await Check.Refuses(() => press.Driver.HandleAsync("state.read", Press.Params("""{"fields":["force"]}""")));
        Check.Equal(RefusalKind.Transient, refusal.Kind);
    }

    public static async Task StateReadReturnsOnlyDeclaredFieldsThatWereAsked()
    {
        using var press = await Ready();
        var result = await press.Driver.HandleAsync("state.read", Press.Params("""{"fields":["force","noise"]}"""));
        Check.Json("""{"force":3.5}""", result["values"]);
    }

    public static async Task ModeAndPresenceAreEnforcedBeforeTheHandler()
    {
        using var press = await Ready();
        Check.Equal(RefusalKind.Refused, (await Check.Refuses(() => press.Invoke("label", """{"text":"x"}""", mode: "monitor-only"))).Kind);
        Check.Equal(RefusalKind.Refused, (await Check.Refuses(() => press.Invoke("force.set", """{"force":1}""", mode: "assist"))).Kind);
        Check.Equal(RefusalKind.Precondition, (await Check.Refuses(() => press.Invoke("stamp", """{"part":"a"}"""))).Kind);
        await press.Invoke("label", """{"text":"x"}""", mode: "assist");
        Check.Equal("e1", string.Join(",", press.Applied));
    }

    public static async Task APassedDeadlineRefusesWithoutActing()
    {
        using var press = await Ready();
        var refusal = await Check.Refuses(() => press.Driver.HandleAsync("action.invoke", Press.Params(
            """{"action":"label","input":{"text":"x"},"effectId":"e1","mode":"actuate","deadline":1}""")));
        Check.Equal(RefusalKind.Transient, refusal.Kind);
        Check.Equal(0, press.Applied.Count);
    }

    public static async Task OnceAndIdempotentActionsRunOncePerEffectAndSurviveARestart()
    {
        using var press = await Ready();
        var first = await press.Invoke("stamp", $$"""{"part":"a","presence":{{Confirmed}}}""", "s1");
        var again = await press.Invoke("stamp", $$"""{"part":"a","presence":{{Confirmed}}}""", "s1");
        Check.Equal(first.ToJsonString(), again.ToJsonString());
        await press.Invoke("label", """{"text":"x"}""", "l1");
        await press.Invoke("label", """{"text":"x"}""", "l1");
        var restarted = press.Restart();
        await Press.Initialize(restarted);
        Check.Json("""{"status":"accepted","ref":"stamp-1"}""", await press.Lookup("s1"));
        await press.Invoke("label", """{"text":"x"}""", "l1");
        Check.Equal("s1,l1", string.Join(",", press.Applied));
    }

    public static async Task ConvergentActionsAreNotDeduplicated()
    {
        using var press = await Ready();
        await press.Invoke("force.set", """{"force":1}""", "f1");
        await press.Invoke("force.set", """{"force":1}""", "f1");
        Check.Equal("f1,f1", string.Join(",", press.Applied));
    }

    public static async Task RejectionsAreRecordedAndATransientFailureCanRunAgain()
    {
        using var press = await Ready();
        var rejected = await Check.Refuses(() => press.Invoke("stamp", $$"""{"part":"bad","presence":{{Confirmed}}}""", "s1"));
        Check.Equal("PART", rejected.Code);
        Check.Json("""{"status":"rejected","code":"PART","message":"No such part"}""", await press.Lookup("s1"));
        Check.Equal(RefusalKind.Transient, (await Check.Refuses(() => press.Invoke("label", """{"text":"busy"}""", "l1"))).Kind);
        Check.Json("""{"status":"unknown"}""", await press.Lookup("l1"));
        await press.Invoke("label", """{"text":"ok"}""", "l1");
        Check.Equal("l1", string.Join(",", press.Applied));
    }

    public static async Task AnActionThatFailsWhileActingIsUncertainAndNeverRepeated()
    {
        using var press = await Ready();
        var crashed = await Check.Refuses(() => press.Invoke("stamp", $$"""{"part":"crash","presence":{{Confirmed}}}""", "s1"));
        Check.Equal(RefusalKind.Uncertain, crashed.Kind);
        Check.Equal("uncertain", (await press.Lookup("s1"))["status"]!.GetValue<string>());
        var again = await Check.Refuses(() => press.Invoke("stamp", $$"""{"part":"a","presence":{{Confirmed}}}""", "s1"));
        Check.Equal(RefusalKind.Uncertain, again.Kind);
        Check.Equal("EFFECT_REUSED", (await Check.Refuses(() => press.Invoke("label", """{"text":"x"}""", "s1"))).Code);
    }

    public static Task OnceActionsNeedAJournal()
    {
        try
        {
            using var driver = new Driver((JsonObject)JsonNode.Parse(Press.Contract)!, Press.Digest, new DriverOptions { Id = "press", Version = "1" });
        }
        catch (ArgumentException)
        {
            return Task.CompletedTask;
        }
        throw new Exception("a contract with once actions was accepted without a journal");
    }

    public static async Task HandlersRunOnTheHandlerThreadAndAwaitsReturnToIt()
    {
        using var thread = new HandlerThread();
        using var press = new Press();
        var seen = new List<bool>();
        var driver = press.Make(thread);
        driver.OnState(async _ =>
        {
            seen.Add(thread.IsCurrent);
            await Task.Delay(1);
            seen.Add(thread.IsCurrent);
            return new Reading(new Dictionary<string, object?> { ["force"] = 1 });
        });
        await Press.Initialize(driver);
        await driver.HandleAsync("state.read", Press.Params("""{"fields":["force"]}"""));
        driver.Dispose();
        Check.Equal("True,True", string.Join(",", seen));
        Check.Equal(OperatingSystem.IsWindows() ? ApartmentState.STA : ApartmentState.Unknown, thread.Apartment);
    }

    public static async Task MessagesOverStreamsEventsAndShutdown()
    {
        var contract = (JsonObject)JsonNode.Parse(Press.Contract)!;
        contract["actions"] = new JsonObject();
        using var driver = new Driver(contract, new string('d', 64), new DriverOptions { Id = "press", Version = "1" });
        driver.OnState(_ =>
        {
            driver.Emit("reading", new { force = 1 });
            driver.Emit("reading", new { force = 2 }); // dropped: above maxRateHz
            return new Reading(new Dictionary<string, object?> { ["force"] = 1 });
        });
        var requests = string.Join("\n",
            "not json",
            """{"jsonrpc":"2.0","id":1,"method":"state.read","params":{"fields":["force"]}}""",
            """{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocol":"1","contract":{"id":"press"}}}""",
            """{"jsonrpc":"2.0","id":3,"method":"state.read","params":{"fields":["force"]}}""",
            """{"jsonrpc":"2.0","id":4,"method":"nope","params":{}}""",
            """{"jsonrpc":"2.0","id":5,"method":"shutdown","params":{}}""") + "\n";
        // Responses are concurrent, so each request is sent after the previous one has its response.
        var toDriver = new Pipe();
        var toHost = new Collector();
        var serving = driver.ServeAsync(toDriver.Reader.AsStream(), toHost);
        foreach (var line in requests.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var responded = toHost.Responses;
            await toDriver.Writer.WriteAsync(Encoding.UTF8.GetBytes(line + "\n"));
            if (line.StartsWith('{')) await toHost.Until(() => toHost.Responses > responded);
        }
        await toDriver.Writer.CompleteAsync();
        await serving;
        var messages = toHost.Messages;
        var byId = messages.Where(message => message["id"] is not null).ToDictionary(message => message["id"]!.GetValue<int>());
        Check.Equal("transient", byId[1]["error"]!["data"]!["kind"]!.GetValue<string>());
        Check.Json("""{"force":1}""", byId[3]["result"]!["values"]);
        Check.Equal(-32601, byId[4]["error"]!["code"]!.GetValue<int>());
        Check.Json("{}", byId[5]["result"]);
        var events = messages.Where(message => message["method"]?.GetValue<string>() == "event").ToList();
        Check.Equal(1, events.Count);
        Check.Json("""{"force":1}""", events[0]["params"]!["payload"]);
        Check.Equal(0, events[0]["params"]!["seq"]!.GetValue<int>());
    }
}

/// <summary>What the driver writes, one parsed message per line, safe to read while it writes.</summary>
internal sealed class Collector : Stream
{
    private readonly List<JsonNode> _messages = [];
    private readonly List<byte> _pending = [];

    public List<JsonNode> Messages
    {
        get { lock (_messages) return [.. _messages]; }
    }

    public int Responses => Messages.Count(message => message["id"] is not null);

    public async Task Until(Func<bool> condition)
    {
        while (!condition()) await Task.Delay(5);
    }

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));

    public override void Write(ReadOnlySpan<byte> buffer)
    {
        lock (_messages)
            foreach (var b in buffer)
            {
                if (b != (byte)'\n')
                {
                    _pending.Add(b);
                    continue;
                }
                _messages.Add(JsonNode.Parse(Encoding.UTF8.GetString([.. _pending]))!);
                _pending.Clear();
            }
    }

    public override void Flush() { }
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
}

[Tests]
internal static class LineReaderTests
{
    public static async Task AnOversizedLineIsDroppedAndALastLineNeedsNoNewline()
    {
        var pipe = new Pipe();
        // More than a pipe buffer holds, so it is written while the reader reads.
        var writing = Task.Run(async () =>
        {
            await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes("one\n"));
            await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes(new string('x', LineReader.MaxLine + 10) + "\n"));
            await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes("two\nthree"));
            await pipe.Writer.CompleteAsync();
        });
        var reader = new LineReader(pipe.Reader.AsStream());
        var found = new List<string>();
        while (await reader.NextAsync() is { } line) found.Add(Encoding.UTF8.GetString(line));
        await writing;
        Check.Equal("one|two|three", string.Join("|", found));
    }
}

[Tests]
internal static class StubTests
{
    private static string File(string document) =>
        $$"""{"digest":"{{ContractFile.Digest(JsonDocument.Parse(document).RootElement)}}","document":{{document}}}""";

    public static Task TheStubHoldsDigestDocumentAndTypedInputs()
    {
        var text = Stubgen.Generate(File(Press.Contract), "Press");
        Check.True(text.Contains($"public const string Digest = \"{Press.Digest}\";"), "digest");
        Check.True(text.Contains("public static class PressContract"), "holder class");
        Check.True(text.Contains("public sealed record StampInput("), "input record");
        Check.True(text.Contains("[property: JsonPropertyName(\"presence\")] StampInputPresence? Presence = null"), "optional nested record");
        Check.True(text.Contains("public sealed record ForceSetInput("), "dotted action name");
        return Task.CompletedTask;
    }

    public static Task TheDigestMatchesTheHostCanonicalForm()
    {
        // JSON.stringify of the sorted document, as the host writes it.
        var document = JsonDocument.Parse("""{"b":[1,2.5,"°C","a\"b\u0001"],"a":{"z":null,"y":true,"Y":1e+21}}""").RootElement;
        const string canonical = """{"a":{"Y":1e+21,"y":true,"z":null},"b":[1,2.5,"°C","a\"b\u0001"]}""";
        Check.Equal(canonical, ContractFile.Canonical(document));
        Check.Equal(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))), ContractFile.Digest(document));
        return Task.CompletedTask;
    }

    public static Task AnEditedDocumentIsRefused()
    {
        var file = (JsonObject)JsonNode.Parse(File(Press.Contract))!;
        file["document"]!["version"] = "2";
        try
        {
            Stubgen.Generate(file.ToJsonString(), "Press");
        }
        catch (InvalidDataException)
        {
            return Task.CompletedTask;
        }
        throw new Exception("an edited document was accepted");
    }
}
