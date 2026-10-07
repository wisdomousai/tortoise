import { isIP } from 'node:net';

/** A parsed IPv4 or IPv6 network. IPv4-mapped IPv6 addresses match IPv4 networks. */
export interface Cidr {
  readonly text: string;
  readonly family: 4 | 6;
  readonly base: bigint;
  readonly bits: number;
}

function ipv4(address: string): bigint {
  return address.split('.').reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
}
function ipv6(address: string): bigint {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing dotted IPv4 part becomes two hextets.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v4 = ipv4(dotted[1]!);
    text =
      text.slice(0, -dotted[1]!.length) +
      `${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group || '0', 16)), 0n);
}

/** Parse `10.0.0.0/8`, `fd00::/8` or a bare address (a host network). Throws on anything else. */
export function parseCidr(text: string): Cidr {
  const [address, prefix] = text.split('/') as [string, string | undefined];
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error(`Invalid address: ${text}`);
  const width = family === 4 ? 32 : 128;
  const bits = prefix === undefined ? width : Number(prefix);
  if (
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > width ||
    (prefix !== undefined && !/^\d+$/.test(prefix))
  )
    throw new Error(`Invalid prefix: ${text}`);
  const value = family === 4 ? ipv4(address) : ipv6(address);
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(width - bits);
  return { text, family, base: value & mask, bits };
}

/** Whether `address` (an IP literal) falls inside `network`. */
export function cidrContains(network: Cidr, address: string): boolean {
  let family = isIP(address);
  let value: bigint;
  if (family === 6) {
    value = ipv6(address);
    // ::ffff:a.b.c.d is an IPv4 peer.
    if (network.family === 4 && value >> 32n === 0xffffn) {
      value &= 0xffffffffn;
      family = 4;
    }
  } else if (family === 4) value = ipv4(address);
  else return false;
  if (family !== network.family) return false;
  const width = family === 4 ? 32 : 128;
  const mask =
    network.bits === 0 ? 0n : ((1n << BigInt(network.bits)) - 1n) << BigInt(width - network.bits);
  return (value & mask) === network.base;
}

const loopbackNetworks = ['127.0.0.0/8', '::1/128'].map(parseCidr);
const privateNetworks = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  'fc00::/7',
  'fe80::/10',
].map(parseCidr);
export const isLoopbackAddress = (address: string) =>
  loopbackNetworks.some((network) => cidrContains(network, address));
/** Loopback, RFC 1918, CGNAT, link-local and unique-local ranges. */
export const isPrivateAddress = (address: string) =>
  isLoopbackAddress(address) || privateNetworks.some((network) => cidrContains(network, address));
export const isLoopbackHost = (host: string) =>
  host === 'localhost' ||
  (isIP(host.replace(/^\[|\]$/g, '')) !== 0 && isLoopbackAddress(host.replace(/^\[|\]$/g, '')));
/** True when every address of `network` is private, e.g. `10.20.0.0/16` but not `0.0.0.0/0`. */
export function cidrIsPrivate(network: Cidr): boolean {
  const pool =
    network.family === 4
      ? [...loopbackNetworks, ...privateNetworks].filter((n) => n.family === 4)
      : [...loopbackNetworks, ...privateNetworks].filter((n) => n.family === 6);
  return pool.some(
    (candidate) => candidate.bits <= network.bits && cidrContainsNetwork(candidate, network),
  );
}
function cidrContainsNetwork(outer: Cidr, inner: Cidr): boolean {
  const width = outer.family === 4 ? 32 : 128;
  const mask =
    outer.bits === 0 ? 0n : ((1n << BigInt(outer.bits)) - 1n) << BigInt(width - outer.bits);
  return (inner.base & mask) === outer.base;
}
