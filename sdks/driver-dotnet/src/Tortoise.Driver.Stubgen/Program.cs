// Generate a C# file from a driver contract file written by `app driver contract <id> --out file.json`:
//
//   dotnet run --project src/Tortoise.Driver.Stubgen -- chamber.json --namespace Chamber -o ChamberContract.cs
//
// Refuses a file whose digest does not match its document.
using Tortoise.Driver;

string? input = null, output = null, space = null, name = null;
for (var index = 0; index < args.Length; index++)
    switch (args[index])
    {
        case "-o" or "--out": output = args[++index]; break;
        case "--namespace": space = args[++index]; break;
        case "--class": name = args[++index]; break;
        default: input = args[index]; break;
    }
if (input is null || space is null)
{
    Console.Error.WriteLine("usage: stubgen <contract.json> --namespace <Namespace> [--class <Name>] [-o <file.cs>]");
    return 2;
}
try
{
    var text = Stubgen.Generate(File.ReadAllText(input), space, name);
    if (output is null) Console.Out.Write(text);
    else File.WriteAllText(output, text);
    return 0;
}
catch (Exception error) when (error is InvalidDataException or System.Text.Json.JsonException or KeyNotFoundException)
{
    Console.Error.WriteLine($"stubgen: {error.Message}");
    return 1;
}
