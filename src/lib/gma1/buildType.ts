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
  /** Where the channel came from (the GDTF attribute), for reports and stand-in choice. */
  source?: string;
  /** Default DMX value (16-bit) for the channel; used for shutters ("open" from the GDTF). */
  defaultValue?: number;
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

function ctBlock(flags: number): Bytes {
  return block(28, [[0, 'i', 0], [4, 'i', -1], [8, 'i', -1], [12, 'i', -1], [16, 'i', flags], [20, 'i', -1], [24, 'f', -1]]);
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

const CT_FINE = 1;
/** Channel kind 2: virtual — the console gives it no DMX slot (used for the virtual dimmer). */
const CT_VIRTUAL = 2;
const CT_BREAK_START = 1 << 4;
const CT_INVERT = 1 << 6;
/** "Follows the virtual dimmer", as on the console's own LED PAR56 colour channels. */
const CT_VDIM = 1 << 8;
const CT_16BIT = 1 << 9;
const CT_COLOR = 1 << 11;

/** Attributes the console flags as colour channels (bit 11) when it creates a channel type. */
const COLOR_ATTRS = new Set(['RED', 'GREEN', 'BLUE', 'COLORMIX1', 'COLORMIX2', 'COLORMIX3', 'COLOR1', 'COLOR2', 'COLOR3']);
/** Colour-mix attribute -> the colour component its channel function drives. */
const CM_INDEX: Record<string, number> = { COLORMIX1: 0, COLORMIX2: 1, COLORMIX3: 2, COLORMIX4: 3 };
/**
 * GDTF attributes of LED emitters. On the colour-mix attributes (CMY-style: 0 % = open) they run
 * inverted, as in the console's own RGB types (LED PAR56, A7: CM1–CM3 with the invert flag).
 */
const ADDITIVE = /^(ColorAdd_|ColorRGB_|White$)/i;
/** The console's colour-mix attribute for the primary emitters. */
const EMITTER_CM: Record<string, string> = {
  coloraddr: 'COLORMIX1', colorrgbred: 'COLORMIX1',
  coloraddg: 'COLORMIX2', colorrgbgreen: 'COLORMIX2',
  coloraddb: 'COLORMIX3', colorrgbblue: 'COLORMIX3',
  coloraddw: 'COLORMIX4', white: 'COLORMIX4',
};
/** Further emitters (amber, UV, lime …) take the colour wheels, in the order they appear. */
const EXTRA_EMITTERS = ['COLOR1', 'COLOR2', 'COLOR3'];
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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
  /**
   * Channels whose attribute is not in the show's pretyp (or is already used in this type), with the
   * stand-in attribute (DUMMY) they were given instead.
   */
  substituted: { from: string; to: string }[];
}

/**
 * Stand-in for channels without a usable attribute. The console accepts DUMMY any number of times in
 * one fixture type (checked with a console-saved type); other attributes appear at most once. A
 * channel is never skipped — that would shift every later DMX slot of the fixture.
 */
const STAND_IN = 'DUMMY';

/** "color_wheel_1 → DUMMY, fixture_control → DUMMY" for notes and reports. */
export function describeSubstitutions(s: BuiltType['substituted']): string {
  return s.map((x) => `${x.from} → ${x.to}`).join(', ');
}

/** Convert a GDTF DMX mode to gma1 channels, mapping GDTF attribute names to gma1 names. */
export function channelsFromGdtf(mode: GdtfMode): GmaChannel[] {
  return mode.channels
    .filter((c) => c.offsets.length > 0) // virtual channels take no DMX slot
    .map((c) => {
      const attribute = gmaAttributeName(c.attribute);
      return {
        attribute, sixteenBit: c.offsets.length >= 2, dmxBreak: c.dmxBreak || 1, source: c.attribute,
        // A shutter starts open when the GDTF names an open range.
        defaultValue: attribute === 'STROBE' ? c.open : undefined,
      };
    })
    .sort((a, b) => a.dmxBreak - b.dmxBreak);
}

function coarseBlock(breakStart: boolean, sixteenBit: boolean, attribute: string, inverted: boolean, def?: number): Bytes {
  const flags = (breakStart ? CT_BREAK_START : 0) | (sixteenBit ? CT_16BIT : 0)
    | (COLOR_ATTRS.has(attribute) ? CT_COLOR : 0) | (inverted ? CT_INVERT : 0);
  const b = ctBlock(flags);
  const v = view(b);
  // Highlight as in the console's own types: dimmer full, colour open (0), everything else none (-1).
  const colour = COLOR_ATTRS.has(attribute) || attribute in CM_INDEX;
  v.setInt32(4, attribute === 'DIM' ? pctToDmx(100) : colour ? 0 : -1, true);
  if (def !== undefined) v.setInt32(0, def, true);
  return b;
}

/**
 * Virtual dimmer, as on the console's own LED PAR56: a DIM channel of kind "virtual" (no DMX slot),
 * closed by default, full on highlight. Added to every fixture without a dimmer channel; the colour
 * channels then follow it (CT_VDIM).
 */
function virtualDimmer(attributeIndex: number): RawChannelType {
  const b = ctBlock(CT_VIRTUAL);
  view(b).setInt32(4, pctToDmx(100), true);
  return { status: ZERO_STATUS, empty: false, attribute: attributeIndex, profile: -1, block: b, functions: [channelFunction('DIM')] };
}

function channelFunction(attr: string) {
  const b = cfBlock(GMA_ATTRIBUTE[attr]?.effId ?? 0);
  // Physical range 0..1 for dimmer and colour mix, as in the console's own types.
  if (attr === 'DIM' || attr in CM_INDEX) view(b).setFloat32(24, 1, true);
  if (attr in CM_INDEX) view(b).setInt32(40, CM_INDEX[attr], true); // colour component 0–3
  return { status: ZERO_STATUS, empty: false, name: attr.slice(0, NAME_MAX), block: b, path: null, sets: [] };
}

/**
 * Build a gma1 fixture type from gma1 channels. Channels keep their order within each DMX
 * break; a 16-bit channel adds a fine channel type after its coarse one. Attributes are resolved by
 * name against the show's pretyp pool; a channel whose attribute is missing or already taken becomes
 * DUMMY (see `STAND_IN`), so the DMX footprint always matches the source. LED emitters go on the
 * colour-mix attributes (inverted), and a fixture without a dimmer channel gets a virtual one that
 * its colour channels follow.
 */
export function buildFixtureType(input: BuildTypeInput): BuiltType {
  const used = new Set<string>();
  const substituted: { from: string; to: string }[] = [];
  const emitters = new Set<string>(); // colour-mix attributes carrying an LED emitter (inverted)
  const channelTypes: RawChannelType[] = [];
  const attrNames: string[] = [];

  const byBreak = new Map<number, GmaChannel[]>();
  for (const c of input.channels) {
    const brk = c.dmxBreak || 1;
    (byBreak.get(brk) ?? byBreak.set(brk, []).get(brk)!).push(c);
  }

  const emitterChannels: number[] = []; // channel types carrying an LED emitter
  [...byBreak.keys()].sort((a, b) => a - b).forEach((brk, breakIdx) => {
    byBreak.get(brk)!.forEach((c, chanIdx) => {
      const source = c.source ?? c.attribute;
      const emitter = ADDITIVE.test(source);
      let attribute = c.attribute;
      if (emitter) {
        // R/G/B/W on the colour-mix attributes, further emitters on the colour wheels in order.
        const primary = EMITTER_CM[key(source)];
        const free = primary && !used.has(primary)
          ? primary
          : EXTRA_EMITTERS.find((a) => input.attributes.has(a) && !used.has(a));
        if (free) attribute = free;
      }
      if (!input.attributes.has(attribute) || (used.has(attribute) && attribute !== STAND_IN)) {
        if (!input.attributes.has(STAND_IN)) {
          throw new Error(`"${input.name}": the show has no ${STAND_IN} attribute for channel ${source}`);
        }
        attribute = STAND_IN;
      }
      if (attribute !== c.attribute) substituted.push({ from: source, to: attribute });
      const idx = input.attributes.get(attribute)!;
      // Emitters run inverted on the console's colour attributes (0 % = open), as in its own types.
      const inverted = emitter && (attribute in CM_INDEX || COLOR_ATTRS.has(attribute));
      if (inverted) emitters.add(attribute);
      used.add(attribute);
      attrNames.push(attribute);
      if (emitter) emitterChannels.push(channelTypes.length);
      channelTypes.push({
        status: ZERO_STATUS, empty: false, attribute: idx, profile: -1,
        block: coarseBlock(breakIdx > 0 && chanIdx === 0, c.sixteenBit, attribute, inverted, c.defaultValue),
        functions: [channelFunction(attribute)],
      });
      if (c.sixteenBit) {
        // The console marks a channel type without channel functions as empty.
        channelTypes.push({ status: ZERO_STATUS, empty: true, attribute: idx, profile: -1, block: ctBlock(CT_FINE), functions: [] });
      }
    });
  });

  const has = (a: string) => attrNames.includes(a);

  // A fixture without a dimmer channel gets a virtual one, and its emitters follow it.
  const dimIndex = input.attributes.get('DIM');
  if (!has('DIM') && dimIndex !== undefined) {
    for (const i of emitterChannels) {
      const v = view(channelTypes[i].block);
      v.setInt32(16, v.getInt32(16, true) | CT_VDIM, true);
    }
    channelTypes.push(virtualDimmer(dimIndex));
    attrNames.push('DIM');
    used.add('DIM');
  }
  let flags = 0;
  if (has('PAN') && has('TILT')) flags |= FT_HAS_PANTILT | FT_HEADMOVER;
  if (has('DIM')) flags |= FT_HAS_DIMMER;
  const rgbOnCm = ['COLORMIX1', 'COLORMIX2', 'COLORMIX3'].every((a) => emitters.has(a));
  if ((has('RED') && has('GREEN') && has('BLUE')) || rgbOnCm) flags |= FT_HAS_RGB | FT_IS_LED;
  if (!has('PAN') && !has('TILT')) flags |= FT_CONVENTIONAL;

  const raw: RawFixtureType = {
    status: ZERO_STATUS, empty: false,
    name: input.name.slice(0, NAME_MAX),
    manufacturer: input.manufacturer || 'GDTF',
    comment: input.comment ?? 'Created in gma1-patcher',
    shortName: (input.shortName || input.name).slice(0, NAME_MAX),
    block: ftBlock(flags), bodyStyle: null, modelKey: null, dummy: null, presets: [], channelTypes,
  };
  return { raw, usedAttributes: [...used], substituted };
}
