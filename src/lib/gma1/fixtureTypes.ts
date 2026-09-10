import {
  ByteWriter, type Bytes, FormatError, concat, decodeLatin1, encodeLatin1, i32, u32, view,
} from './binary';

/**
 * Codec for the `fixturetypes` pool member and the `pretyp` attribute pool.
 *
 * The pool is a stream of objects (see tree.ts) with these class tags:
 *   0x19 root · 0x17 fixture type · 0x15 channel type · 0x13 channel function · 0x23/0xa3 channel set.
 * Fixed-size value blocks (84/28/44/20 bytes) are kept as raw bytes so a decode→encode round-trips
 * byte for byte; generators build them from a template and patch only understood fields.
 */

export const TAG_FT_ROOT = 0x19;
export const TAG_FT_TYPE = 0x17;
export const TAG_FT_CHANTYPE = 0x15;
export const TAG_FT_CHANFUNC = 0xa3;
export const TAG_FT_CHANSET = 0x13;

const NAME_MAX = 18; // FIXSTRING<19>

export interface RawChannelSet {
  status: Bytes; // 8-byte PICSTATUS
  empty: boolean;
  name: string;
  block: Bytes; // 20 bytes
  csdata: string | null;
  images: [Bytes, Bytes, Bytes]; // three MEMBLOCK2 gel tables, usually empty
  media: string | null; // only for file version > 0x1964
}

export interface RawChannelFunction {
  status: Bytes;
  empty: boolean;
  name: string;
  block: Bytes; // 44 bytes
  path: string | null;
  sets: RawChannelSet[];
}

export interface RawChannelType {
  status: Bytes;
  empty: boolean;
  attribute: number; // index into the pretyp attribute pool
  profile: number; // DMX profile index, -1 = none
  block: Bytes; // 28 bytes
  functions: RawChannelFunction[];
}

export interface RawPreset {
  name: string;
  presetNr: number;
  items: number[];
}

export interface RawFixtureType {
  status: Bytes;
  empty: boolean;
  name: string;
  manufacturer: string | null;
  comment: string | null;
  shortName: string | null;
  block: Bytes; // 84 bytes
  bodyStyle: string | null;
  modelKey: string | null;
  dummy: string | null;
  presets: RawPreset[];
  channelTypes: RawChannelType[];
}

export interface FixtureTypePool {
  version: number;
  rootStatus: Bytes;
  rootEmpty: boolean;
  types: RawFixtureType[];
}

// --- reader --------------------------------------------------------------------------------------

class Reader {
  p = 4;
  constructor(private b: Bytes, public version: number) {}

  u32() {
    const v = u32(this.b, this.p);
    this.p += 4;
    return v;
  }
  i32() {
    const v = i32(this.b, this.p);
    this.p += 4;
    return v;
  }
  fix() {
    const n = this.u32();
    const s = decodeLatin1(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  string(): string | null {
    const n = i32(this.b, this.p);
    this.p += 4;
    if (n < 0) return null;
    const s = decodeLatin1(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  block(len: number) {
    const b = this.b.slice(this.p, this.p + len);
    this.p += len;
    return b;
  }
  memblock() {
    const n = this.u32();
    return this.block(n);
  }
  picid(expect: number): { empty: boolean } {
    const w = this.u32();
    if ((w & 0xffff) !== 0x4950) throw new FormatError(`expected PICID at ${this.p - 4}`);
    const tag = (w >>> 16) & 0x7fff;
    if (tag !== expect) throw new FormatError(`expected tag ${expect.toString(16)}, got ${tag.toString(16)}`);
    return { empty: (w & 0x80000000) !== 0 };
  }
  status() {
    return this.block(8);
  }
  trailer(start: number) {
    const size = this.u32();
    if (size !== this.p - 4 - start) throw new FormatError(`bad size trailer at ${this.p - 4}`);
  }
  collection<T>(read: () => T): T[] {
    const end = this.u32();
    const n = this.u32();
    const items = Array.from({ length: n }, read);
    if (this.p !== end) throw new FormatError(`collection end mismatch at ${this.p}`);
    return items;
  }
}

function readSet(r: Reader): RawChannelSet {
  const start = r.p;
  const { empty } = r.picid(TAG_FT_CHANSET);
  const status = r.status();
  const name = r.fix();
  const block = r.memblock();
  const csdata = r.string();
  const images = [r.memblock(), r.memblock(), r.memblock()] as [Bytes, Bytes, Bytes];
  const media = r.version > 0x1964 ? r.string() : null;
  r.trailer(start);
  return { status, empty, name, block, csdata, images, media };
}

function readFunction(r: Reader): RawChannelFunction {
  const start = r.p;
  const { empty } = r.picid(TAG_FT_CHANFUNC);
  const status = r.status();
  const name = r.fix();
  const block = r.memblock();
  const path = r.string();
  const sets = r.collection(() => readSet(r));
  r.trailer(start);
  return { status, empty, name, block, path, sets };
}

function readChannelType(r: Reader): RawChannelType {
  const start = r.p;
  const { empty } = r.picid(TAG_FT_CHANTYPE);
  const status = r.status();
  const attribute = r.i32();
  const profile = r.i32();
  const block = r.memblock();
  const functions = r.collection(() => readFunction(r));
  r.trailer(start);
  return { status, empty, attribute, profile, block, functions };
}

function readType(r: Reader): RawFixtureType {
  const start = r.p;
  const { empty } = r.picid(TAG_FT_TYPE);
  const status = r.status();
  const name = r.fix();
  const manufacturer = r.string();
  const comment = r.string();
  const shortName = r.string();
  const block = r.memblock();
  const bodyStyle = r.string();
  const modelKey = r.string();
  const dummy = r.string();
  const presets = r.collection((): RawPreset => {
    const pname = r.fix();
    const presetNr = r.i32();
    const items = r.collection(() => r.i32());
    return { name: pname, presetNr, items };
  });
  const channelTypes = r.collection(() => readChannelType(r));
  r.trailer(start);
  return { status, empty, name, manufacturer, comment, shortName, block, bodyStyle, modelKey, dummy, presets, channelTypes };
}

export function parseFixtureTypePool(b: Bytes): FixtureTypePool {
  if (b[0] !== 0x41 || b[1] !== 0x4d) throw new FormatError('fixturetypes: missing AM header');
  const version = view(b).getUint16(2, true);
  const r = new Reader(b, version);
  const start = r.p;
  const { empty } = r.picid(TAG_FT_ROOT);
  const rootStatus = r.status();
  const types = r.collection(() => readType(r));
  r.trailer(start);
  if (r.p !== b.length) throw new FormatError('fixturetypes: trailing bytes');
  return { version, rootStatus, rootEmpty: empty, types };
}

// --- writer --------------------------------------------------------------------------------------

class Writer {
  w = new ByteWriter();
  constructor(public version: number) {}

  fix(s: string) {
    const b = encodeLatin1(s.slice(0, NAME_MAX));
    this.w.u32(b.length);
    this.w.bytes(b);
  }
  string(s: string | null) {
    if (s === null) {
      this.w.i32(-1);
      return;
    }
    const b = encodeLatin1(s);
    this.w.i32(b.length);
    this.w.bytes(b);
  }
  memblock(b: Bytes) {
    this.w.u32(b.length);
    this.w.bytes(b);
  }
  object(tag: number, empty: boolean, status: Bytes, body: () => void, collection?: () => void) {
    const start = this.w.pos;
    this.w.u32(0x4950 | (tag << 16) | (empty ? 0x80000000 : 0));
    this.w.bytes(status);
    body();
    if (collection) collection();
    this.w.u32(this.w.pos - start);
  }
  collection<T>(items: T[], write: (item: T) => void) {
    const hdr = this.w.pos;
    this.w.u32(0);
    this.w.u32(items.length);
    for (const it of items) write(it);
    this.w.setU32(hdr, this.w.pos);
  }
}

function writeSet(w: Writer, s: RawChannelSet) {
  w.object(TAG_FT_CHANSET, s.empty, s.status, () => {
    w.fix(s.name);
    w.memblock(s.block);
    w.string(s.csdata);
    for (const img of s.images) w.memblock(img);
    if (w.version > 0x1964) w.string(s.media);
  });
}

function writeFunction(w: Writer, f: RawChannelFunction) {
  w.object(TAG_FT_CHANFUNC, f.empty, f.status, () => {
    w.fix(f.name);
    w.memblock(f.block);
    w.string(f.path);
  }, () => w.collection(f.sets, (s) => writeSet(w, s)));
}

function writeChannelType(w: Writer, c: RawChannelType) {
  w.object(TAG_FT_CHANTYPE, c.empty, c.status, () => {
    w.w.i32(c.attribute);
    w.w.i32(c.profile);
    w.memblock(c.block);
  }, () => w.collection(c.functions, (f) => writeFunction(w, f)));
}

function writeType(w: Writer, t: RawFixtureType) {
  w.object(TAG_FT_TYPE, t.empty, t.status, () => {
    w.fix(t.name);
    w.string(t.manufacturer);
    w.string(t.comment);
    w.string(t.shortName);
    w.memblock(t.block);
    w.string(t.bodyStyle);
    w.string(t.modelKey);
    w.string(t.dummy);
    w.collection(t.presets, (p) => {
      w.fix(p.name);
      w.w.i32(p.presetNr);
      w.collection(p.items, (v) => w.w.i32(v));
    });
  }, () => w.collection(t.channelTypes, (c) => writeChannelType(w, c)));
}

export function serializeFixtureTypePool(pool: FixtureTypePool): Bytes {
  const w = new Writer(pool.version);
  w.w.bytes(new Uint8Array([0x41, 0x4d, pool.version & 0xff, (pool.version >> 8) & 0xff]));
  w.object(TAG_FT_ROOT, pool.rootEmpty, pool.rootStatus, () => {}, () =>
    w.collection(pool.types, (t) => writeType(w, t)));
  return w.w.result();
}

// --- attribute pool (pretyp) ---------------------------------------------------------------------

/** Attribute name (upper case, e.g. "PAN") -> its index, read from the show's `pretyp` member. */
export function parseAttributeIndex(pretyp: Bytes): Map<string, number> {
  const map = new Map<string, number>();
  const dv = view(pretyp);
  for (let p = 4; p + 4 <= pretyp.length; p++) {
    if (pretyp[p] === 0x50 && pretyp[p + 1] === 0x49 && pretyp[p + 2] === 0x0b &&
        (pretyp[p + 3] === 0 || pretyp[p + 3] === 0x80)) {
      const n = dv.getUint32(p + 12, true);
      if (n > 40) continue;
      const name = decodeLatin1(pretyp.subarray(p + 16, p + 16 + n));
      const q = p + 16 + n; // PrettyName (fixstring) then attrib_index (i32)
      const pn = dv.getUint32(q, true);
      const idx = dv.getInt32(q + 4 + pn, true);
      if (!map.has(name)) map.set(name, idx);
    }
  }
  return map;
}

/** Percentage (0..100) as the console stores default/highlight/from/to: round(pct * 655.36). */
export function pctToDmx(pct: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(pct * 655.36)));
}

export { concat };
