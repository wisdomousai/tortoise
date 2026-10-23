import type { NetworkProtocol } from '@agent-native/contracts';

export const schemes: Record<NetworkProtocol, string> = {
  https: 'https:',
  http: 'http:',
  wss: 'wss:',
  ws: 'ws:',
  tcp: 'tcp:',
  udp: 'udp:',
};
/** The plain-text scheme of an encrypted protocol, accepted on loopback with a warning. */
export const plaintextOf: Partial<Record<NetworkProtocol, string>> = {
  https: 'http:',
  wss: 'ws:',
};
const defaultPorts: Partial<Record<string, number>> = {
  'https:': 443,
  'http:': 80,
  'wss:': 443,
  'ws:': 80,
};
export const portOf = (url: URL) => (url.port ? Number(url.port) : defaultPorts[url.protocol]);
/** Judged on the URL actually bound, so a mismatched declaration cannot mask plain text. */
export const encrypted = (url: URL, binding: { tls?: boolean }) =>
  url.protocol === 'https:' ||
  url.protocol === 'wss:' ||
  (url.protocol === 'tcp:' && binding.tls === true);
export const plaintextApplication = (url: URL) =>
  url.protocol === 'http:' || url.protocol === 'ws:';
