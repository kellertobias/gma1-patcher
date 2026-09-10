import { type Bytes, decodeLatin1, i32, u32 } from './binary';

export interface ChannelType {
  attribute: number;
  profile: number;
  /** 0x1C bytes: default, highlight, stage, fade, flags, mode index, effect time. */
  block: Bytes;
  /** 0 coarse, 1 fine. */
  kind: number;
  breakStart: boolean;
}

export interface FixtureType {
  index: number;
  name: string;
  /** DMX slots per break, derived the way the console does on load. */
  breaks: number[];
  /** Channel types whose kind is not understood (footprint may be wrong). */
  unknown: number;
  channelTypes: ChannelType[];
}

function findTag(b: Bytes, tag: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p + 4 <= to; p++) {
    if (b[p] === 0x50 && b[p + 1] === 0x49 && b[p + 2] === tag && (b[p + 3] === 0 || b[p + 3] === 0x80)) out.push(p);
  }
  return out;
}

/**
 * Fixture types (tag 0x17) in pool order, which is the index fixtures refer to. Each break has
 * one slot per channel type (tag 0x15), coarse and fine alike; dmx_break_start opens a new break.
 */
export function parseFixtureTypes(ft: Bytes): FixtureType[] {
  const starts = findTag(ft, 0x17, 4, ft.length);
  return starts.map((o, index) => {
    const n = u32(ft, o + 12);
    const name = decodeLatin1(ft.subarray(o + 16, o + 16 + n));
    const end = index + 1 < starts.length ? starts[index + 1] : ft.length;
    const t: FixtureType = { index, name, breaks: [0], unknown: 0, channelTypes: [] };
    for (const c of findTag(ft, 0x15, o + 16 + n, end)) {
      const p = c + 12;
      if (u32(ft, p + 8) !== 0x1c) {
        t.unknown++;
        continue;
      }
      const block = ft.slice(p + 12, p + 12 + 0x1c);
      const flags = u32(block, 16);
      const ct: ChannelType = {
        attribute: i32(ft, p),
        profile: i32(ft, p + 4),
        block,
        kind: flags & 0xf,
        breakStart: ((flags >> 4) & 1) === 1,
      };
      t.channelTypes.push(ct);
      if (ct.breakStart && t.breaks[t.breaks.length - 1]) t.breaks.push(0);
      if (ct.kind === 0 || ct.kind === 1) t.breaks[t.breaks.length - 1]++;
      else t.unknown++;
    }
    return t;
  });
}
