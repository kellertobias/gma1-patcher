import { ByteWriter, type Bytes, FormatError, decodeLatin1, encodeLatin1, u16, u32 } from './binary';
import { type TarEntry, gunzip, readTar } from './archive';
import { type Member, type PicNode, parseMemberStrict } from './tree';
import { TAG_CHANNEL, TAG_FIXTURE, TAG_LAYER, TAG_ROOT } from './records';
import { type FixtureType, parseFixtureTypes } from './types';
import {
  type FixtureTypePool, parseFixtureTypePool,
  serializeFixtureTypePool as serializeFixtureTypePoolBytes,
} from './fixtureTypes';
import { type ShowAttribute, parseShowAttributes } from './pretypPool';

/** Oldest file version whose fixture record layout is implemented (5.901). */
export const MIN_VERSION = 0x170d;

export interface ShoHeader {
  version: number;
  title: string;
  fileName: string;
  user: string;
  /** Offset of: u32 channels, u32 fixtures, u32 0, u32 time (s since midnight), u32 date (ordinal). */
  countsOffset: number;
}

export function parseSho(sho: Bytes): ShoHeader {
  if (sho.length < 8 || sho[0] !== 0x41 || sho[1] !== 0x4d) throw new FormatError('not a gma1 .sho file');
  const version = u16(sho, 2);
  const strings: string[] = [];
  let p = 4;
  for (let i = 0; i < 3; i++) {
    const n = u32(sho, p);
    if (p + 4 + n > sho.length) throw new FormatError('.sho header is truncated');
    strings.push(decodeLatin1(sho.subarray(p + 4, p + 4 + n)));
    p += 4 + n;
  }
  const countsOffset = p + 16;
  if (countsOffset + 20 > sho.length) throw new FormatError('.sho header is truncated');
  return { version, title: strings[0], fileName: strings[1], user: strings[2], countsOffset };
}

export interface LoadedShow {
  /** File name without extension; the output keeps it (the .sho refers to it). */
  baseName: string;
  sho: Bytes;
  header: ShoHeader;
  entries: TarEntry[];
  showrow: Member;
  root: PicNode;
  /** Fixture-type footprints (index = position in the pool). */
  types: FixtureType[];
  /** The full fixture-type pool; the `fixturetypes` member is regenerated from it on write. */
  fixtureTypePool: FixtureTypePool;
  /** Attribute name (e.g. "PAN") -> index in this show's `pretyp` pool. */
  attributes: Map<string, number>;
  /** Full attribute definitions from `pretyp` (name -> index, pretty name, feature, preset). */
  attributeInfo: Map<string, ShowAttribute>;
}

/**
 * Return a copy of the show with `pool` as its fixture-type pool and matching footprints.
 * Existing type indices are preserved because new types are appended.
 */
export function withFixtureTypePool(show: LoadedShow, pool: FixtureTypePool): LoadedShow {
  const bytes = serializeFixtureTypePoolBytes(pool);
  return { ...show, fixtureTypePool: pool, types: parseFixtureTypes(bytes) };
}

/**
 * Reconstruct the .sho header when only the archive is opened. The `info` member is a byte copy of
 * the .sho, so it is used directly; otherwise a minimal header is synthesized (the file version is
 * taken from any member's `AM` prefix, and counts/date are rewritten on export anyway).
 */
function deriveSho(entries: TarEntry[], baseName: string): Bytes {
  const info = entries.find((e) => e.name === 'info')?.data;
  if (info && info.length >= 8 && info[0] === 0x41 && info[1] === 0x4d) return new Uint8Array(info);

  const anyMember = entries.find((e) => e.data.length >= 4 && e.data[0] === 0x41 && e.data[1] === 0x4d)?.data;
  const version = anyMember ? u16(anyMember, 2) : 0x19c8;
  const w = new ByteWriter();
  w.bytes(new Uint8Array([0x41, 0x4d, version & 0xff, (version >> 8) & 0xff]));
  const str = (s: string) => {
    const b = encodeLatin1(s);
    w.u32(b.length);
    w.bytes(b);
  };
  str(baseName.toUpperCase());
  str(`${baseName}.sho`);
  str('Administrator');
  w.bytes(new Uint8Array([0x18, 0, 0, 0, 0, 0x10, 0, 0, 0, 0x10, 0, 0, 0, 0, 0, 0])); // constants
  for (let i = 0; i < 5; i++) w.u32(0); // channels, fixtures, 0, time, date (rewritten on export)
  return w.result();
}

export function loadShow(baseName: string, shoInput: Bytes | undefined, tgz: Bytes): LoadedShow {
  const entries = readTar(gunzip(tgz));
  // Own copy: a Node Buffer's slice() is a view, and the builder must never touch the input.
  const sho = shoInput ? new Uint8Array(shoInput) : deriveSho(entries, baseName);
  const header = parseSho(sho);
  if (header.version < MIN_VERSION) {
    throw new FormatError(`show file version ${header.version} is older than supported (${MIN_VERSION})`);
  }
  const data = (name: string) => entries.find((e) => e.name === name)?.data;
  const sr = data('showrow');
  const ft = data('fixturetypes');
  const pretyp = data('pretyp');
  if (!sr || !ft) throw new FormatError('the archive has no showrow or fixturetypes member');

  const showrow = parseMemberStrict(sr, 'showrow');
  const root = showrow.roots[0];
  if (showrow.roots.length !== 1 || root.tag !== TAG_ROOT || !root.coll) {
    throw new FormatError('showrow: unexpected root object');
  }
  for (const layer of root.children) {
    if (layer.tag !== TAG_LAYER) throw new FormatError('showrow: unexpected object instead of a layer');
    for (const f of layer.children) {
      if (f.tag !== TAG_FIXTURE) throw new FormatError('showrow: unexpected object instead of a fixture');
      if (f.children.some((c) => c.tag !== TAG_CHANNEL)) throw new FormatError('showrow: unexpected fixture child');
    }
  }
  const attributeInfo = pretyp ? parseShowAttributes(pretyp) : new Map<string, ShowAttribute>();
  return {
    baseName, sho, header, entries, showrow, root,
    types: parseFixtureTypes(ft),
    fixtureTypePool: parseFixtureTypePool(ft),
    attributes: new Map([...attributeInfo].map(([name, a]) => [name, a.index])),
    attributeInfo,
  };
}
