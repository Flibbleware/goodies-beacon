import { describe, expect, it } from 'vitest';
import {
  assertFetchableUrl,
  assertPublicAddress,
  BlockedAddressError,
  isBlockedAddress,
} from './ssrf.js';

const resolves =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private, top of the range'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1', '8.8.8.8'])(
    'allows the public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it.each(['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::'])(
    'blocks the IPv6 address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );

  it('allows a public IPv6 address', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  /** ::ffff:127.0.0.1 reaches loopback just as well as 127.0.0.1 does. */
  it('sees through an IPv4-mapped IPv6 address', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:1.1.1.1')).toBe(false);
  });

  it('treats anything it cannot parse as blocked', () => {
    for (const value of ['', 'not-an-ip', '999.1.1.1', '1.2.3']) {
      expect(isBlockedAddress(value)).toBe(true);
    }
  });
});

describe('assertFetchableUrl', () => {
  it('accepts an ordinary image URL', () => {
    expect(assertFetchableUrl('https://i.ebayimg.com/images/g/abc/s-l1600.jpg').hostname).toBe(
      'i.ebayimg.com',
    );
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x.jpg', 'data:image/png;base64,AAA'])(
    'refuses %s',
    (url) => {
      expect(() => assertFetchableUrl(url)).toThrow(BlockedAddressError);
    },
  );

  it('refuses a URL carrying credentials', () => {
    expect(() => assertFetchableUrl('http://user:pass@example.com/x.jpg')).toThrow(/credentials/);
  });

  it('refuses a literal private address without needing to resolve anything', () => {
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /private address/,
    );
    expect(() => assertFetchableUrl('http://[::1]:5432/')).toThrow(/private address/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => assertFetchableUrl('¯\\_(ツ)_/¯')).toThrow(BlockedAddressError);
  });
});

describe('assertPublicAddress', () => {
  it('allows a hostname that resolves to a public address', async () => {
    const url = new URL('https://example.com/x.jpg');
    await expect(assertPublicAddress(url, resolves('93.184.216.34'))).resolves.toBeUndefined();
  });

  /** The reason the check is on the address, not the name: a name can point anywhere. */
  it('refuses a public hostname that resolves to loopback', async () => {
    const url = new URL('https://totally-legit.example/x.jpg');
    await expect(assertPublicAddress(url, resolves('127.0.0.1'))).rejects.toThrow(
      /private address/,
    );
  });

  /** Picking the public answer would be doing exactly what a rebinding attack wants. */
  it('refuses when any answer is private, not just the first', async () => {
    const url = new URL('https://mixed.example/x.jpg');
    await expect(assertPublicAddress(url, resolves('93.184.216.34', '10.0.0.5'))).rejects.toThrow(
      /private address/,
    );
  });

  it('refuses a name that resolves to nothing', async () => {
    const url = new URL('https://void.example/x.jpg');
    await expect(assertPublicAddress(url, resolves())).rejects.toThrow(/resolves to nothing/);
  });

  it('refuses when resolution fails rather than carrying on', async () => {
    const url = new URL('https://broken.example/x.jpg');
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicAddress(url, failing)).rejects.toThrow(/could not resolve/);
  });
});
