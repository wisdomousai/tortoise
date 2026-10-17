// A child for the process plugin's tests: prints its arguments and environment as one JSON line,
// then echoes stdin lines until stdin closes or `--hang` keeps it running.
const hang = process.argv.includes('--hang');
console.log(JSON.stringify({ args: process.argv.slice(2), env: process.env }));
if (hang) setInterval(() => undefined, 1_000);
else for await (const line of console) console.log(line);

export {};
