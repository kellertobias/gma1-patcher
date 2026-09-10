import { ByteWriter, type Bytes, FormatError, equalBytes, view } from './binary';

/**
 * One serialized object of a gma1 pool member.
 *
 * On disk: PICID ('P' 'I' u16 tag, bit 31 = empty) · PICSTATUS · payload · [collection] · u32 size,
 * where size counts from the PICID to the trailer and a collection is
 * u32 end_pos · u32 count · children, end_pos being the absolute member offset after the last child.
 * Both values are checked by the console on load, so they are recomputed on every write.
 */
export interface PicNode {
  tag: number;
  empty: boolean;
  /** Bytes from the PICID up to the collection header (or up to the size trailer). */
  head: Bytes;
  /** Whether the object ends with a collection (possibly empty). */
  coll: boolean;
  children: PicNode[];
  /** Bytes between the end of the collection and the size trailer (always empty so far). */
  tail: Bytes;
}

export interface Member {
  /** "AM" + u16 file version. */
  prefix: Bytes;
  roots: PicNode[];
  suffix: Bytes;
}

const EMPTY = new Uint8Array(0);

/**
 * Top-down parse. Payload bytes can look like a PICID or like a size trailer (a name length of 12
 * at offset 12, a channel index of 40 at offset 40, …), so a trailer candidate is only accepted when
 * the next object starts right after it or it ends exactly where the enclosing collection ends, and a
 * collection header only when its end_pos equals the enclosing trailer. Remaining ambiguity is
 * resolved by backtracking.
 */
class Parser {
  private dv: DataView;
  private budget = 5_000_000;

  constructor(private b: Bytes) {
    this.dv = view(b);
  }

  private isPicId(p: number) {
    return p + 12 <= this.b.length && this.b[p] === 0x50 && this.b[p + 1] === 0x49;
  }

  private spend() {
    if (--this.budget < 0) throw new FormatError('object tree is too ambiguous to reconstruct');
  }

  /** Object at `s` whose size trailer is at `t`. */
  node(s: number, t: number): PicNode | null {
    const word = this.dv.getUint16(s + 2, true);
    const base = { tag: word & 0x7fff, empty: (word & 0x8000) !== 0, tail: EMPTY };
    for (let h = s + 12; h + 8 < t; h++) {
      if (this.dv.getUint32(h, true) !== t) continue;
      const count = this.dv.getUint32(h + 4, true);
      if (count < 1 || !this.isPicId(h + 8)) continue;
      this.spend();
      const children = this.sequence(h + 8, t, count);
      if (children) return { ...base, head: this.b.slice(s, h), coll: true, children };
    }
    if (t - 8 >= s + 12 && this.dv.getUint32(t - 8, true) === t && this.dv.getUint32(t - 4, true) === 0) {
      return { ...base, head: this.b.slice(s, t - 8), coll: true, children: [] };
    }
    return { ...base, head: this.b.slice(s, t), coll: false, children: [] };
  }

  /** `count` objects (any number when null) filling [pos, end) exactly. */
  sequence(pos: number, end: number, count: number | null): PicNode[] | null {
    const out: PicNode[] = [];
    // Iterative over siblings; backtracking happens through the explicit stack of choices.
    const choices: { pos: number; t: number }[] = [];
    let t = pos + 12;
    for (;;) {
      const done = count === null ? pos === end : out.length === count;
      if (done && pos === end) return out;
      let found = -1;
      if (!done && pos < end && this.isPicId(pos)) {
        const last = count !== null && out.length === count - 1;
        for (let c = last ? Math.max(t, end - 4) : t; c + 4 <= end; c++) {
          if (this.dv.getUint32(c, true) !== c - pos) continue;
          if (c + 4 !== end && (last || !this.isPicId(c + 4))) continue;
          this.spend();
          const n = this.node(pos, c);
          if (n) {
            out.push(n);
            found = c;
            break;
          }
        }
      }
      if (found >= 0) {
        choices.push({ pos, t: found });
        pos = found + 4;
        t = pos + 12;
        continue;
      }
      // Dead end: revisit the previous sibling with its next trailer candidate.
      const prev = choices.pop();
      if (!prev) return null;
      out.pop();
      pos = prev.pos;
      t = prev.t + 1;
    }
  }
}

/** Rebuild the object tree of a pool member from its size trailers and collection headers. */
export function parseMember(b: Bytes): Member {
  if (b.length < 4 || b[0] !== 0x41 || b[1] !== 0x4d) throw new FormatError('member does not start with AM');
  const roots = new Parser(b).sequence(4, b.length, null);
  if (!roots) throw new FormatError('could not reconstruct the object tree');
  return { prefix: b.slice(0, 4), roots, suffix: EMPTY };
}

function writeNode(w: ByteWriter, n: PicNode) {
  const start = w.pos;
  w.bytes(n.head);
  if (n.coll) {
    const hdr = w.pos;
    w.u32(0);
    w.u32(n.children.length);
    for (const c of n.children) writeNode(w, c);
    w.setU32(hdr, w.pos);
  }
  w.bytes(n.tail);
  w.u32(w.pos - start);
}

export function serializeMember(m: Member): Bytes {
  const w = new ByteWriter();
  w.bytes(m.prefix);
  for (const r of m.roots) writeNode(w, r);
  w.bytes(m.suffix);
  return w.result();
}

/** Parse and check that re-serializing reproduces the input byte for byte. */
export function parseMemberStrict(b: Bytes, what: string): Member {
  const m = parseMember(b);
  if (!equalBytes(serializeMember(m), b)) {
    throw new FormatError(`${what}: re-serialization does not reproduce the file`);
  }
  return m;
}
