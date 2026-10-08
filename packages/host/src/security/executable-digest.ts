import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

let executableDigest: Promise<string> | undefined;
/** SHA-256 of the running executable (the compiled binary, or the Bun runtime in development). */
export function digestExecutable(): Promise<string> {
  return (executableDigest ??= new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(process.execPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  }).catch(() => 'unavailable'));
}
