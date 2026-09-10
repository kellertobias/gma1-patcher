export type Bytes = Uint8Array;

/** The input does not match the gma1 file format as far as it is understood. */
export class FormatError extends Error {
  name = 'FormatError';
}

export function view(b: Bytes): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

export const u16 = (b: Bytes, o: number) => view(b).getUint16(o, true);
export const i16 = (b: Bytes, o: number) => view(b).getInt16(o, true);
export const u32 = (b: Bytes, o: number) => view(b).getUint32(o, true);
export const i32 = (b: Bytes, o: number) => view(b).getInt32(o, true);
export const f32 = (b: Bytes, o: number) => view(b).getFloat32(o, true);

/** Growable little-endian byte buffer. */
export class ByteWriter {
  private buf = new Uint8Array(4096);
  pos = 0;

  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  bytes(b: Bytes) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  u32(v: number) {
    this.ensure(4);
    new DataView(this.buf.buffer).setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  i32(v: number) {
    this.ensure(4);
    new DataView(this.buf.buffer).setInt32(this.pos, v, true);
    this.pos += 4;
  }

  setU32(at: number, v: number) {
    new DataView(this.buf.buffer).setUint32(at, v >>> 0, true);
  }

  result(): Bytes {
    return this.buf.slice(0, this.pos);
  }
}

export function concat(parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function decodeLatin1(b: Bytes): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

export function encodeLatin1(s: string): Bytes {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f; // '?'
  }
  return out;
}
