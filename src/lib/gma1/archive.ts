import { deflateSync, gunzipSync } from 'fflate';
import { type Bytes, FormatError, decodeLatin1, encodeLatin1 } from './binary';

/** One entry of the old-style (v7) tar written by the console. */
export interface TarEntry {
  /** Name without a leading "./". */
  name: string;
  header: Bytes;
  data: Bytes;
}

const BLOCK = 512;
const RECORD = 10240; // console archives are padded to a multiple of 20 blocks

function field(h: Bytes, from: number, len: number) {
  return h.subarray(from, from + len);
}

function parseOctal(f: Bytes): number {
  const s = decodeLatin1(f).replace(/[\0 ]/g, '');
  return s ? parseInt(s, 8) : 0;
}

export function readTar(tar: Bytes): TarEntry[] {
  const entries: TarEntry[] = [];
  let p = 0;
  while (p + BLOCK <= tar.length) {
    const h = tar.subarray(p, p + BLOCK);
    if (h.every((x) => x === 0)) break;
    const rawName = decodeLatin1(field(h, 0, 100)).replace(/\0[\s\S]*$/, '');
    const size = parseOctal(field(h, 124, 12));
    if (p + BLOCK + size > tar.length) throw new FormatError(`tar entry ${rawName} is truncated`);
    entries.push({
      name: rawName.replace(/^\.\//, ''),
      header: h.slice(),
      data: tar.slice(p + BLOCK, p + BLOCK + size),
    });
    p += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

// Numeric fields are right-aligned with spaces, as the console writes them:
// size "         40 ", checksum "  5312\0 ".
function checksum(h: Bytes): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum;
}

function hasValidChecksum(h: Bytes): boolean {
  const stored = decodeLatin1(field(h, 148, 8)).replace(/[\0 ]/g, '');
  return stored !== '' && parseInt(stored, 8) === checksum(h);
}

function withSize(header: Bytes, size: number): Bytes {
  const h = header.slice();
  const digits = size.toString(8);
  if (digits.length > 11) throw new FormatError('tar entry too large');
  h.set(encodeLatin1(digits.padStart(11, ' ') + ' '), 124);
  h.set(encodeLatin1(checksum(h).toString(8).padStart(6, ' ') + '\0 '), 148);
  return h;
}

export function writeTar(entries: TarEntry[]): Bytes {
  const parts: Bytes[] = [];
  let total = 0;
  for (const e of entries) {
    // Headers are kept byte for byte unless the size changed or the checksum is broken — the console
    // rejects the whole archive on a single bad header checksum.
    const keep = parseOctal(field(e.header, 124, 12)) === e.data.length && hasValidChecksum(e.header);
    const header = keep ? e.header : withSize(e.header, e.data.length);
    const padded = new Uint8Array(Math.ceil(e.data.length / BLOCK) * BLOCK);
    padded.set(e.data);
    parts.push(header, padded);
    total += header.length + padded.length;
  }
  const end = Math.ceil((total + 2 * BLOCK) / RECORD) * RECORD;
  const out = new Uint8Array(end);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function gunzip(b: Bytes): Bytes {
  if (b[0] !== 0x1f || b[1] !== 0x8b) throw new FormatError('not a gzip file');
  return gunzipSync(b);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Bytes): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** gzip wrapper as written by the console: no file name, mtime 0, XFL 0, OS 0x0B (NTFS). */
export function gzipLikeConsole(data: Bytes): Bytes {
  const body = deflateSync(data, { level: 9 });
  const out = new Uint8Array(10 + body.length + 8);
  out.set([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x0b]);
  out.set(body, 10);
  const dv = new DataView(out.buffer);
  dv.setUint32(10 + body.length, crc32(data), true);
  dv.setUint32(14 + body.length, data.length >>> 0, true);
  return out;
}
