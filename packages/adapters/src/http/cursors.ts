import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Authenticated encryption hides journal counts and binds cursors to a session. Restart resets cursors. */
export class Cursors {
  private key = randomBytes(32);
  encode(cursor: number, revision: number, token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(token));
    const data = Buffer.concat([cipher.update(JSON.stringify([cursor, revision])), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  decode(value: string, token: string): [number, number] | undefined {
    try {
      const data = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(token));
      decipher.setAuthTag(data.subarray(12, 28));
      const result: unknown = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      );
      if (
        Array.isArray(result) &&
        result.length === 2 &&
        result.every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        return result as [number, number];
    } catch {}
    return undefined;
  }
}
