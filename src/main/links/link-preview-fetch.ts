import { lookup } from 'node:dns/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { linkCardTarget } from '@/shared/contracts/link-card';

const blocked = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');

function publicAddress(address: string) {
  const family = isIP(address);
  return Boolean(
    family &&
    (family === 4 || globalV6.check(address, 'ipv6')) &&
    !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6'),
  );
}

/** The addresses checked here are the ones used by the socket, including on every redirect. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true, verbatim: true }).then(
    (addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
        callback(new Error('LINK_PREVIEW_ADDRESS_BLOCKED'), '', 4);
      } else if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
    (error: Error) => callback(error, '', 4),
  );
};

function publicUrl(value: string) {
  const target = linkCardTarget(value);
  if (!target || target.kind === 'CODEX') throw new Error('LINK_PREVIEW_URL_BLOCKED');
  const url = new URL(target.url);
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (
    (url.port && !['80', '443'].includes(url.port)) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan)\.?$/u.test(host) ||
    (isIP(host) && !publicAddress(host))
  )
    throw new Error('LINK_PREVIEW_ADDRESS_BLOCKED');
  return url;
}

interface PreviewResponse {
  url: string;
  contentType: string;
  bytes: Buffer;
}

export async function fetchLinkResource(
  value: string,
  signal: AbortSignal,
  maxBytes: number,
  accept: string,
  prefixOnly = false,
): Promise<PreviewResponse> {
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const result = await new Promise<PreviewResponse | { location: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsGet : httpGet)(
        url,
        {
          agent: false,
          lookup: publicLookup,
          signal,
          headers: { accept, 'accept-encoding': 'identity', 'user-agent': 'AIY-LinkPreview/1.0' },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            resolve({ location: response.headers.location });
            response.destroy();
            return;
          }
          if (status < 200 || status >= 300 || (!prefixOnly && Number(response.headers['content-length']) > maxBytes)) {
            reject(new Error('LINK_PREVIEW_RESPONSE_UNAVAILABLE'));
            response.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          const finish = () =>
            resolve({
              url: url.href,
              contentType: response.headers['content-type'] ?? '',
              bytes: Buffer.concat(chunks, size),
            });
          response.on('data', (chunk: Buffer) => {
            if (prefixOnly && size + chunk.length >= maxBytes) {
              chunks.push(chunk.subarray(0, maxBytes - size));
              size = maxBytes;
              finish();
              response.destroy();
              return;
            }
            size += chunk.length;
            if (size > maxBytes) response.destroy(new Error('LINK_PREVIEW_RESPONSE_TOO_LARGE'));
            else chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', finish);
        },
      );
      request.on('error', reject);
    });
    if ('bytes' in result) return result;
    url = publicUrl(new URL(result.location, url).href);
  }
  throw new Error('LINK_PREVIEW_TOO_MANY_REDIRECTS');
}
