import { type Bytes, view } from './binary';
import { type RawChannelType, type RawFixtureType, pctToDmx } from './fixtureTypes';
import { GMA_ATTRIBUTE, gmaAttributeName } from './attributes';
import type { GdtfMode } from '../mvr/gdtf';

const NAME_MAX = 18;

/** A channel of a gma1 fixture type: a gma1 attribute, its resolution, and its DMX break. */
export interface GmaChannel {
  /** gma1 attribute name (e.g. "PAN"), as used in the show's pretyp pool. */
  attribute: string;
  sixteenBit: boolean;
  dmxBreak: number;
}

// Value blocks are constructed field by field from the documented layouts (docs/FORMAT.md).
const ZERO_STATUS = new Uint8Array(8);

function block(bytes: number, fields: [number, 'i' | 'f', number][]): Bytes {
  const b = new Uint8Array(bytes);
  const dv = view(b);
  for (const [off, kind, val] of fields) {
    if (kind === 'i') dv.setInt32(off, val, true);
    else dv.setFloat32(off, val, true);
  }
  return b;
}

const FULL = 0xffff;

function ftBlock(flags: number): Bytes {
  return block(84, [
    [0, 'i', 0], [4, 'f', 10000], [8, 'f', 10000], [12, 'i', flags], [16, 'i', -1], [20, 'i', -1],
    [24, 'f', 30], [28, 'f', 30], [72, 'f', 1], [80, 'f', 0.2],
  ]);
}

function ctBlock(flags: number, coarse: boolean): Bytes {
  return coarse
    ? block(28, [[0, 'i', 0], [4, 'i', FULL], [8, 'i', -1], [12, 'i', -1], [16, 'i', flags], [20, 'i', -1], [24, 'f', 0]])
    : block(28, [[0, 'i', 0], [4, 'i', -1], [8, 'i', -1], [12, 'i', -1], [16, 'i', flags], [20, 'i', -1], [24, 'f', -1]]);
}

function cfBlock(effect: number): Bytes {
  return block(44, [[0, 'i', 0], [4, 'i', FULL], [8, 'i', 0], [12, 'i', FULL], [32, 'i', 2], [36, 'i', effect]]);
}

const FT_HEADMOVER = 1 << 0;
const FT_CONVENTIONAL = 1 << 3;
const FT_HAS_DIMMER = 1 << 4;
const FT_HAS_PANTILT = 1 << 6;
const FT_IS_LED = 1 << 8;
const FT_HAS_RGB = 1 << 10;

const CT_BREAK_START = 1 << 4;
const CT_16BIT = 1 << 9;

export interface BuildTypeInput {
  name: string;
  manufacturer: string;
  shortName: string;
  comment?: string;
  channels: GmaChannel[];
  /** Attribute name -> index in the target show's pretyp pool. */
  attributes: Map<string, number>;
}

export interface BuiltType {
  raw: RawFixtureType;
  usedAttributes: string[];
  /** gma1 attribute names used by a channel but not present in the show's pretyp. */
  missing: string[];
}

/** Convert a GDTF DMX mode to gma1 channels, mapping GDTF attribute names to gma1 names. */
export function channelsFromGdtf(mode: GdtfMode): GmaChannel[] {
  return mode.channels
    .filter((c) => c.offsets.length > 0) // virtual channels take no DMX slot
    .map((c) => ({ attribute: gmaAttributeName(c.attribute), sixteenBit: c.offsets.length >= 2, dmxBreak: c.dmxBreak || 1 }))
    .sort((a, b) => a.dmxBreak - b.dmxBreak);
}

function coarseBlock(breakStart: boolean, sixteenBit: boolean): Bytes {
  const b = ctBlock((breakStart ? CT_BREAK_START : 0) | (sixteenBit ? CT_16BIT : 0), true);
  view(b).setInt32(4, pctToDmx(100), true); // highlight full
  return b;
}

function channelFunction(attr: string) {
  return { status: ZERO_STATUS, empty: false, name: attr.slice(0, NAME_MAX), block: cfBlock(GMA_ATTRIBUTE[attr]?.effId ?? 0), path: null, sets: [] };
}

/**
 * Build a gma1 fixture type from gma1 channels. Channels keep their order within each DMX
 * break; a 16-bit channel adds a fine channel type after its coarse one. Attributes are resolved by
 * name against the show's pretyp pool; unknown ones are reported in `missing` and skipped.
 */
export function buildFixtureType(input: BuildTypeInput): BuiltType {
  const usedAttributes = new Set<string>();
  const missing = new Set<string>();
  const channelTypes: RawChannelType[] = [];
  const attrNames: string[] = [];

  const byBreak = new Map<number, GmaChannel[]>();
  for (const c of input.channels) {
    const brk = c.dmxBreak || 1;
    (byBreak.get(brk) ?? byBreak.set(brk, []).get(brk)!).push(c);
  }

  [...byBreak.keys()].sort((a, b) => a - b).forEach((brk, breakIdx) => {
    byBreak.get(brk)!.forEach((c, chanIdx) => {
      const idx = input.attributes.get(c.attribute);
      if (idx === undefined) {
        missing.add(c.attribute);
        return;
      }
      usedAttributes.add(c.attribute);
      attrNames.push(c.attribute);
      channelTypes.push({
        status: ZERO_STATUS, empty: false, attribute: idx, profile: -1,
        block: coarseBlock(breakIdx > 0 && chanIdx === 0, c.sixteenBit), functions: [channelFunction(c.attribute)],
      });
      if (c.sixteenBit) {
        channelTypes.push({ status: ZERO_STATUS, empty: false, attribute: idx, profile: -1, block: ctBlock(1 /* FINE */, false), functions: [] });
      }
    });
  });

  const has = (a: string) => attrNames.includes(a);
  let flags = 0;
  if (has('PAN') && has('TILT')) flags |= FT_HAS_PANTILT | FT_HEADMOVER;
  if (has('DIM')) flags |= FT_HAS_DIMMER;
  if (has('RED') && has('GREEN') && has('BLUE')) flags |= FT_HAS_RGB | FT_IS_LED;
  if (!has('PAN') && !has('TILT')) flags |= FT_CONVENTIONAL;

  const raw: RawFixtureType = {
    status: ZERO_STATUS, empty: false,
    name: input.name.slice(0, NAME_MAX),
    manufacturer: input.manufacturer || 'GDTF',
    comment: input.comment ?? 'Created in gma1-patcher',
    shortName: (input.shortName || input.name).slice(0, NAME_MAX),
    block: ftBlock(flags), bodyStyle: null, modelKey: null, dummy: null, presets: [], channelTypes,
  };
  return { raw, usedAttributes: [...usedAttributes], missing: [...missing] };
}
