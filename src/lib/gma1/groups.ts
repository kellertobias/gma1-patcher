/**
 * The `group` pool: 999 fixed slots, each a group of fixtures. Checked against a console save.
 *
 * Layout (see docs/FORMAT.md):
 * ```
 * root 0x6D  status(8)  [end_pos count=999  slot*999]  [end_pos count=999  i32*999]  size
 * slot 0x6B  status(8)  name(FIXSTRING)  [end_pos count  i32*count]  size   // used
 * slot 0x806B status(8) u32 0  size                                          // empty (20 bytes)
 * ```
 * A group's members are fixture **old indices** (`id_fixture.oldIndex`), not fixture IDs, and the
 * second array holds the pool's own order (identity in an empty show).
 */
import { ByteWriter, type Bytes, FormatError, decodeLatin1, encodeLatin1, u32, view } from './binary';

const TAG_GROUP_ROOT = 0x6d;
const TAG_GROUP = 0x6b;
export const GROUP_SLOTS = 999;
/** Longest group name the console writes (as for fixtures). */
export const GROUP_NAME_MAX = 18;

export interface Group {
  name: string;
  /**
   * Old indices of the fixtures in the group, or null when the object carries no member list at all
   * (PICID bit 31, as for every other empty object). An unused slot is `{ name: '', fixtures: null }`.
   */
  fixtures: number[] | null;
  /** PICSTATUS of the slot, kept so untouched slots round-trip. */
  status: Bytes;
}

export interface GroupPool {
  /** "AM" + file version. */
  prefix: Bytes;
  rootStatus: Bytes;
  /** One entry per slot, used or not. */
  slots: Group[];
  /** The pool's order array (second collection), kept as read. */
  order: number[];
}

/** Whether a slot holds a group (the console leaves status bytes in unused slots). */
export function isUsed(g: Group): boolean {
  return g.name !== '' || (g.fixtures?.length ?? 0) > 0;
}

const picId = (tag: number, empty: boolean) => (0x4950 | (tag << 16) | (empty ? 0x80000000 : 0)) >>> 0;

export function parseGroupPool(b: Bytes): GroupPool {
  if (b.length < 24 || b[0] !== 0x41 || b[1] !== 0x4d) throw new FormatError('group: missing AM header');
  const v = view(b);
  if (v.getUint16(6, true) !== TAG_GROUP_ROOT) throw new FormatError('group: unexpected root object');
  const count = u32(b, 20);
  let p = 24;
  const slots: Group[] = [];
  for (let i = 0; i < count; i++) {
    const noList = (b[p + 3] & 0x80) !== 0;
    const status = b.slice(p + 4, p + 12);
    const nameLen = u32(b, p + 12);
    const name = decodeLatin1(b.subarray(p + 16, p + 16 + nameLen));
    const after = p + 16 + nameLen;
    let fixtures: number[] | null = null;
    let end = after;
    if (!noList) {
      const n = u32(b, after + 4);
      fixtures = Array.from({ length: n }, (_, k) => v.getInt32(after + 8 + 4 * k, true));
      end = after + 8 + 4 * n;
    }
    const size = u32(b, end);
    if (size !== end - p) throw new FormatError(`group: bad size on slot ${i}`);
    slots.push({ name, fixtures, status });
    p = end + 4;
  }
  const orderCount = u32(b, p + 4);
  const order = Array.from({ length: orderCount }, (_, k) => v.getInt32(p + 8 + 4 * k, true));
  return { prefix: b.slice(0, 4), rootStatus: b.slice(4 + 4, 16), slots, order };
}

export function serializeGroupPool(pool: GroupPool): Bytes {
  const w = new ByteWriter();
  w.bytes(pool.prefix);
  const rootStart = w.pos;
  w.u32(picId(TAG_GROUP_ROOT, false));
  w.bytes(pool.rootStatus);
  const slotsHeader = w.pos;
  w.u32(0);
  w.u32(pool.slots.length);
  for (const g of pool.slots) {
    const start = w.pos;
    w.u32(picId(TAG_GROUP, g.fixtures === null));
    w.bytes(g.status);
    const name = encodeLatin1(g.name.slice(0, GROUP_NAME_MAX));
    w.u32(name.length);
    w.bytes(name);
    if (g.fixtures) {
      const collHeader = w.pos;
      w.u32(0);
      w.u32(g.fixtures.length);
      for (const f of g.fixtures) w.i32(f);
      w.setU32(collHeader, w.pos);
    }
    w.u32(w.pos - start);
  }
  w.setU32(slotsHeader, w.pos);
  const orderHeader = w.pos;
  w.u32(0);
  w.u32(pool.order.length);
  for (const o of pool.order) w.i32(o);
  w.setU32(orderHeader, w.pos);
  w.u32(w.pos - rootStart);
  return w.result();
}

/** A pool with `groups` written into the free slots, keeping the existing ones. */
export function withGroups(pool: GroupPool, groups: { name: string; fixtures: number[] }[]): GroupPool {
  const slots = [...pool.slots];
  let next = 0;
  for (const g of groups) {
    while (next < slots.length && isUsed(slots[next])) next++;
    if (next >= slots.length) throw new FormatError(`the group pool is full (${slots.length} slots)`);
    slots[next] = { name: g.name.slice(0, GROUP_NAME_MAX), fixtures: g.fixtures, status: slots[next].status };
  }
  return { ...pool, slots };
}
