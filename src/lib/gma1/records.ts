import {
  ByteWriter, type Bytes, FormatError, decodeLatin1, encodeLatin1, f32, i16, i32, u32, view,
} from './binary';

// Class tags in the `showrow` member.
export const TAG_ROOT = 0x29;
export const TAG_LAYER = 0x27;
export const TAG_FIXTURE = 0x25;
export const TAG_CHANNEL = 0x23;

/** FIXSTRING<19>: the console asserts length < 19. */
export const NAME_MAX = 18;

const FIXTURE_BLOCK = 0x5c;
const LAYER_BLOCK = 0x14;
const STAGE_CALIBRATION = 80;

function readFixString(b: Bytes, o: number): [string, number] {
  const n = u32(b, o);
  return [decodeLatin1(b.subarray(o + 4, o + 4 + n)), o + 4 + n];
}

function writeFixString(w: ByteWriter, s: string) {
  const b = encodeLatin1(s.slice(0, NAME_MAX));
  w.u32(b.length);
  w.bytes(b);
}

function skipString(b: Bytes, o: number): number {
  return o + 4 + Math.max(i32(b, o), 0);
}

/**
 * Fixture record (SHARED_FIXTURE::operator<<): name, 0x5C-byte data block starting at id_fixture,
 * colour + gobo strings, stage calibration, fixture type index, patch (ARRAY_ANZ<int,4>),
 * 3D data blocks and video strings. Unknown parts are carried through unchanged.
 */
export interface FixtureRecord {
  pre: Bytes; // PICID + PICSTATUS
  name: string;
  block: Bytes; // 0x5C bytes, see fixture* accessors
  mid: Bytes; // colour string, gobo string, stage calibration
  typeIndex: number;
  /** One absolute 0-based DMX address per break; -1 = unpatched. */
  patch: number[];
  post: Bytes;
}

export function decodeFixture(head: Bytes): FixtureRecord {
  let p = 12;
  const [name, afterName] = readFixString(head, p);
  p = afterName;
  const size = u32(head, p);
  if (size !== FIXTURE_BLOCK) throw new FormatError(`fixture "${name}": data block of ${size} bytes`);
  const block = head.slice(p + 4, p + 4 + size);
  p += 4 + size;
  const midStart = p;
  p = skipString(head, p);
  p = skipString(head, p);
  p += STAGE_CALIBRATION;
  const mid = head.slice(midStart, p);
  const typeIndex = i32(head, p);
  const count = u32(head, p + 4);
  if (count > 4 || u32(head, p + 8) !== count * 4) throw new FormatError(`fixture "${name}": bad patch array`);
  const patch: number[] = [];
  for (let i = 0; i < count; i++) patch.push(i32(head, p + 12 + 4 * i));
  return { pre: head.slice(0, 12), name, block, mid, typeIndex, patch, post: head.slice(p + 12 + 4 * count) };
}

export function encodeFixture(f: FixtureRecord): Bytes {
  const w = new ByteWriter();
  w.bytes(f.pre);
  writeFixString(w, f.name);
  w.u32(f.block.length);
  w.bytes(f.block);
  w.bytes(f.mid);
  w.i32(f.typeIndex);
  w.u32(f.patch.length);
  w.u32(f.patch.length * 4);
  for (const a of f.patch) w.i32(a);
  w.bytes(f.post);
  return w.result();
}

// Offsets inside the fixture data block (struct SHARED_FIXTURE from +0x68).
export interface FixtureBlockFields {
  fixId: number;
  chanId: number;
  oldIndex: number;
  position: [number, number, number];
}

export function readFixtureBlock(block: Bytes): FixtureBlockFields {
  return {
    fixId: i16(block, 0),
    chanId: i16(block, 2),
    oldIndex: i16(block, 4),
    position: [f32(block, 8), f32(block, 12), f32(block, 16)],
  };
}

export function writeFixtureBlock(block: Bytes, f: Partial<FixtureBlockFields> & { guid?: Bytes }): Bytes {
  const out = block.slice();
  const dv = view(out);
  if (f.fixId !== undefined) dv.setInt16(0, f.fixId, true);
  if (f.chanId !== undefined) dv.setInt16(2, f.chanId, true);
  if (f.oldIndex !== undefined) dv.setInt16(4, f.oldIndex, true);
  if (f.position) f.position.forEach((v, i) => dv.setFloat32(8 + 4 * i, v, true));
  if (f.guid) out.set(f.guid, 76);
  return out;
}

/** Layer record (SHARED_SHOW_ROW): name and a 20-byte block starting with min/max IDs. */
export interface LayerRecord {
  pre: Bytes;
  name: string;
  block: Bytes;
}

export function decodeLayer(head: Bytes): LayerRecord {
  const [name, p] = readFixString(head, 12);
  const size = u32(head, p);
  if (size !== LAYER_BLOCK || p + 4 + size !== head.length) throw new FormatError(`layer "${name}": unexpected layout`);
  return { pre: head.slice(0, 12), name, block: head.slice(p + 4) };
}

export function encodeLayer(l: LayerRecord): Bytes {
  const w = new ByteWriter();
  w.bytes(l.pre);
  writeFixString(w, l.name);
  w.u32(l.block.length);
  w.bytes(l.block);
  return w.result();
}

/** Set min/max channel and fixture IDs (in that order: minChan, maxChan, minFix, maxFix). */
export function withLayerIdRange(block: Bytes, ids: { chan: number[]; fix: number[] }): Bytes {
  const out = block.slice();
  const dv = view(out);
  const set = (o: number, list: number[]) => {
    if (!list.length) return;
    dv.setInt16(o, Math.min(...list), true);
    dv.setInt16(o + 2, Math.max(...list), true);
  };
  set(0, ids.chan);
  set(4, ids.fix);
  return out;
}

/** A layer made from nothing (PICSTATUS and block values as seen in console files). */
export function newLayerRecord(name: string): LayerRecord {
  const pre = new Uint8Array(12);
  pre.set([0x50, 0x49, TAG_LAYER, 0x00]);
  const block = new Uint8Array(LAYER_BLOCK);
  view(block).setInt16(10, -1, true); // old_showrow_index = (0, -1)
  return { pre, name, block };
}

// Channel record (SHARED_CHANNEL), 48 bytes: PICID, PICSTATUS, u32 0x18, default, highlight,
// stage, fade, flags, i16 old_channel_index + i16, channel type index, DMX profile index.
export const CHANNEL_HEAD_SIZE = 48;

export function channelOldIndex(head: Bytes): number {
  return i16(head, 36);
}

export function withChannelOldIndex(head: Bytes, index: number): Bytes {
  const out = head.slice();
  view(out).setInt16(36, index, true);
  return out;
}
