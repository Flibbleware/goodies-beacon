import { isIP } from 'node:net';

/**
 * The guard on fetching an image from a URL a marketplace gave us (§12).
 *
 * A listing's photo URL is attacker-influenced: whoever wrote the listing chose it. Without this,
 * a seller could point it at `http://169.254.169.254/` and have the worker fetch cloud metadata,
 * or at `http://localhost:5432` to probe the database — the worker sits inside the compose
 * network, which is the actual security boundary (§12), so it can reach things the internet
 * cannot.
 *
 * Blocking by address rather than by hostname, after resolution, because `evil.example.com` can
 * resolve to 127.0.0.1 as easily as `localhost` does.
 */

export class BlockedAddressError extends Error {
  override readonly name = 'BlockedAddressError';
}

/** Only these; `file:`, `ftp:` and `data:` have no business here. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** CIDR blocks that must never be fetched from. */
const BLOCKED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, and cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function isBlockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;

  for (const [network, bits] of BLOCKED_V4) {
    const base = ipv4ToInt(network);
    if (base === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (base & mask) >>> 0) return true;
  }
  return false;
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0] ?? '';

  // An IPv4-mapped address is an IPv4 address wearing a different hat: ::ffff:127.0.0.1 reaches
  // loopback just as well, so it is judged by the IPv4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isBlockedV4(mapped[1]);

  if (lower === '::' || lower === '::1') return true;
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  // Multicast.
  if (lower.startsWith('ff')) return true;
  return false;
}

/** True for an address the worker must not connect to. Unparseable counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedV4(address);
  if (family === 6) return isBlockedV6(address);
  return true;
}

/**
 * Rejects a URL outright on its shape — protocol, credentials, a literal private address. A
 * hostname still has to be resolved and checked separately, which is `assertPublicAddress`.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError(`not a URL: ${raw}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedAddressError(`refusing to fetch a ${url.protocol} URL`);
  }
  // Credentials in an image URL are a redirect trick, not a legitimate shape.
  if (url.username || url.password) {
    throw new BlockedAddressError('refusing a URL carrying credentials');
  }

  const host = url.hostname.replace(/^\[|]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) {
    throw new BlockedAddressError(`refusing to fetch a private address: ${host}`);
  }

  return url;
}

export type Resolver = (hostname: string) => Promise<readonly string[]>;

/**
 * Resolves a hostname and refuses if *any* answer is private.
 *
 * Any, not the first: a name that resolves to both a public and a private address is a DNS
 * rebinding attempt, and picking the public one would be doing what the attacker wanted. This
 * still leaves a window between the check and the connection — closing that needs the socket
 * pinned to the checked address, which undici does not expose; the cap and content-type check
 * behind it are what limit the damage.
 */
export async function assertPublicAddress(url: URL, resolve: Resolver): Promise<void> {
  const host = url.hostname.replace(/^\[|]$/g, '');
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new BlockedAddressError(`refusing to fetch a private address: ${host}`);
    }
    return;
  }

  const addresses = await resolve(host).catch(() => {
    throw new BlockedAddressError(`could not resolve ${host}`);
  });

  if (addresses.length === 0) throw new BlockedAddressError(`${host} resolves to nothing`);

  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedAddressError(`${host} resolves to a private address: ${address}`);
    }
  }
}
