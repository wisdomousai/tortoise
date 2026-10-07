// Minimal JSON-lines perception worker for tests: reports a model, answers each request with the
// field ids it was asked for, and fails or exits on demand.
import { createInterface } from 'node:readline';

console.log(JSON.stringify({ type: 'ready', model: { id: 'echo-ocr', version: '0.1' } }));
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line) as {
    id: number;
    fields: { id: string; type: string }[];
    image: string | null;
  };
  if (request.fields.some((field) => field.id === 'boom')) {
    console.log(JSON.stringify({ id: request.id, error: 'cannot read' }));
    return;
  }
  const exit = request.fields.some((field) => field.id === 'exit');
  console.log(
    JSON.stringify({
      id: request.id,
      readings: [
        ...request.fields.map((field) => ({
          field: field.id,
          value: field.type === 'number' ? 42 : `${field.id}:${request.image ? 'pixels' : 'none'}`,
          confidence: 0.8,
        })),
        { field: 'smuggled', value: 'x', confidence: 1 },
      ],
    }),
  );
  // Answer, then end the process, as a crashing or recycled runtime would.
  if (exit) process.exit(0);
});
