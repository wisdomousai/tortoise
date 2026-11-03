/**
 * Screenshots for the documentation pages. A shots spec (`showcase/examples/<app>/e2e/*.shots.ts`)
 * runs its application, seeds records, asserts what is on screen and calls `shot` for each
 * picture a page shows. The PNGs are committed under `docs/assets/screenshots/<app>/`;
 * `bun run docs:screenshots` regenerates them when a screen changes.
 */
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Write `docs/assets/screenshots/<app>/<name>.png` of `target`, with animations off. */
export async function shot(
  target: Page | Locator,
  app: string,
  name: string,
  options: { mask?: Locator[]; fullPage?: boolean } = {},
) {
  const directory = join(root, 'docs/assets/screenshots', app);
  mkdirSync(directory, { recursive: true });
  await target.screenshot({
    path: join(directory, `${name}.png`),
    animations: 'disabled',
    mask: options.mask,
    ...('goto' in target ? { fullPage: options.fullPage } : {}),
  });
}

/** The bearer token of a running service, for seeding records over its HTTP API. */
export async function bearerOf(connectionFile: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const connection = JSON.parse(await readFile(connectionFile, 'utf8')) as { token?: string };
  if (!connection.token) throw new Error(`No token in ${connectionFile}`);
  return connection.token;
}

/** Run one command over the HTTP API; a seed uses fixed idempotency keys so reruns are no-ops. */
export async function command(
  origin: string,
  token: string,
  id: string,
  input: Record<string, unknown>,
  idempotencyKey: string,
) {
  const response = await fetch(`${origin}/api/v1/commands/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ input, idempotencyKey }),
  });
  if (!response.ok) throw new Error(`${id}: ${response.status} ${await response.text()}`);
  return response.json();
}
