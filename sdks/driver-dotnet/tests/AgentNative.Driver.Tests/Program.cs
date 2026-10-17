// The SDK's own rules, without a host: gating, deduplication, the journal across a restart,
// serving over streams, the line reader, the handler thread and stub generation.
// `dotnet run --project tests/AgentNative.Driver.Tests` prints one line per test and exits 1 on a failure.
using System.Reflection;
using AgentNative.Driver.Tests;

var tests = typeof(DriverTests).Assembly.GetTypes()
    .Where(type => type.Namespace == "AgentNative.Driver.Tests" && type.GetCustomAttribute<TestsAttribute>() is not null)
    .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Static)
        .Where(method => method.ReturnType == typeof(Task))
        .Select(method => (Name: $"{type.Name}.{method.Name}", Run: (Func<Task>)method.CreateDelegate(typeof(Func<Task>)))))
    .OrderBy(test => test.Name, StringComparer.Ordinal)
    .ToList();
var failed = 0;
foreach (var (name, run) in tests)
    try
    {
        await run().WaitAsync(TimeSpan.FromSeconds(30));
        Console.WriteLine($"pass  {name}");
    }
    catch (Exception error)
    {
        failed++;
        Console.WriteLine($"FAIL  {name}: {(error is TargetInvocationException { InnerException: { } inner } ? inner : error).Message}");
    }
Console.WriteLine($"{tests.Count - failed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
