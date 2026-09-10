import { type Bytes, view } from './binary';
import { type RawChannelType, type RawFixtureType, pctToDmx } from './fixtureTypes';
import { GMA_ATTRIBUTE, gmaAttributeName } from './attributes';
import type { GdtfMode } from '../mvr/gdtf';

const NAME_MAX = 18;

// Value blocks are constructed field by field from the documented layouts (docs/FORMAT.md), so no
// captured factory bytes are embedded. All values are functional defaults.
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

// Fixture type block (84 B): version, W min/max, flags@12, MIB delay/fade, angles, vectors, scale.
function ftBlock(flags: number): Bytes {
  return block(84, [
    [0, 'i', 0], [4, 'f', 10000], [8, 'f', 10000], [12, 'i', flags], [16, 'i', -1], [20, 'i', -1],
    [24, 'f', 30], [28, 'f', 30], [72, 'f', 1] /* body scale */, [80, 'f', 0.2] /* hot spot */,
  ]);
}

// Channel type block (28 B): default, highlight, stage, MIB fade, flags@16, mode index, effect time.
function ctBlock(flags: number, coarse: boolean): Bytes {
  return coarse
    ? block(28, [[0, 'i', 0], [4, 'i', FULL], [8, 'i', -1], [12, 'i', -1], [16, 'i', flags], [20, 'i', -1], [24, 'f', 0]])
    : block(28, [[0, 'i', 0], [4, 'i', -1], [8, 'i', -1], [12, 'i', -1], [16, 'i', flags], [20, 'i', -1], [24, 'f', -1]]);
}

// Channel function block (44 B): DMX from/to, mode from/to, phys from/to, T-max, valid flag, effect.
function cfBlock(effect: number): Bytes {
  return block(44, [[0, 'i', 0], [4, 'i', FULL], [8, 'i', 0], [12, 'i', FULL], [32, 'i', 2] /* valid */, [36, 'i', effect]]);
}

// Fixture-type flag bits (block offset 12).
const FT_HEADMOVER = 1 << 0;
const FT_CONVENTIONAL = 1 << 3;
const FT_HAS_DIMMER = 1 << 4;
const FT_HAS_PANTILT = 1 << 6;
const FT_IS_LED = 1 << 8;
const FT_HAS_RGB = 1 << 10;

// Channel-type flag bits (block offset 16): low nibble is COARSE(0)/FINE(1)/VIRTUAL(2).
const CT_BREAK_START = 1 << 4;
const CT_16BIT = 1 << 9;

export interface BuildTypeInput {
  name: string;
  manufacturer: string;
  shortName: string;
  mode: GdtfMode;
  /** Attribute name -> index in the target show's pretyp pool. */
  attributes: Map<string, number>;
}

export interface BuiltType {
  raw: RawFixtureType;
  /** grandMA1 attribute names that were used. */
  usedAttributes: string[];
  /** GDTF attribute names with no grandMA1 equivalent in this show. */
  missing: string[];
}

function coarseBlock(breakStart: boolean, sixteenBit: boolean): Bytes {
  const flags = (breakStart ? CT_BREAK_START : 0) | (sixteenBit ? CT_16BIT : 0);
  const b = ctBlock(flags, true);
  view(b).setInt32(4, pctToDmx(100), true); // highlight full
  return b;
}

function channelFunction(attr: string) {
  return {
    status: ZERO_STATUS, empty: false, name: attr.slice(0, NAME_MAX),
    block: cfBlock(GMA_ATTRIBUTE[attr]?.effId ?? 0), path: null, sets: [],
  };
}

/**
 * Build a grandMA1 fixture type from a GDTF DMX mode. One coarse channel per DMX channel, one fine
 * channel for each extra offset (16/24-bit). Channels are ordered by DMX slot so the footprint per
 * break equals the GDTF footprint. Attributes are resolved by name against the show's pool.
 */
export function buildFixtureType(input: BuildTypeInput): BuiltType {
  const usedAttributes = new Set<string>();
  const missing = new Set<string>();
  const channelTypes: RawChannelType[] = [];
  const attrNames: string[] = [];

  // Group channels by break, ordered by first offset, matching the console's slot order.
  const byBreak = new Map<number, typeof input.mode.channels>();
  for (const c of input.mode.channels) {
    if (!c.offsets.length) continue; // virtual channels take no DMX slot
    const brk = c.dmxBreak || 1;
    (byBreak.get(brk) ?? byBreak.set(brk, []).get(brk)!).push(c);
  }
  const breaks = [...byBreak.keys()].sort((a, b) => a - b);

  breaks.forEach((brk, breakIdx) => {
    const channels = [...byBreak.get(brk)!].sort((a, b) => a.offsets[0] - b.offsets[0]);
    channels.forEach((c, chanIdx) => {
      const gma = gmaAttributeName(c.attribute);
      const idx = input.attributes.get(gma);
      if (idx === undefined) {
        missing.add(`${c.attribute} → ${gma}`);
        return;
      }
      usedAttributes.add(gma);
      const first = breakIdx > 0 && chanIdx === 0;
      const sixteenBit = c.offsets.length >= 2;
      channelTypes.push({
        status: ZERO_STATUS, empty: false, attribute: idx, profile: -1,
        block: coarseBlock(first, sixteenBit), functions: [channelFunction(gma)],
      });
      attrNames.push(gma);
      for (let i = 1; i < c.offsets.length; i++) {
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
    comment: `Imported from GDTF (${input.mode.name})`,
    shortName: (input.shortName || input.name).slice(0, NAME_MAX),
    block: ftBlock(flags), bodyStyle: null, modelKey: null, dummy: null, presets: [], channelTypes,
  };
  return { raw, usedAttributes: [...usedAttributes], missing: [...missing] };
}
