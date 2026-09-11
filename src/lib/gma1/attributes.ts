/**
 * gma1 attribute vocabulary and the GDTF→gma1 attribute mapping, shared by the fixture-type
 * builder and the gma1 fixture-file (`_FIXTURETYPE`) exporter.
 *
 * Each gma1 attribute belongs to a feature and a preset type (as in the `pretyp` pool) and has a
 * visualizer effect and a short label. Values are the software's standard vocabulary.
 */
export interface AttributeInfo {
  feature: string;
  preset: string;
  /** Visualizer-effect keyword (as used in the `_EFF` field / effect id table). */
  eff: string;
  /** Numeric visualizer-effect id. */
  effId: number;
  label: string;
}

// Effect keyword -> id (subset of the software's enum; see docs/FORMAT.md).
export const EFFECT_ID: Record<string, number> = {
  NONE: 0, PAN: 1, TILT: 2, GOBO: 3, GOBO_ROTATE: 5, COLOR: 6, COLOR_MIX: 8, DIMMER: 9, STROBE: 10,
  ZOOM: 11, IRIS: 12, FOCUS: 13, PRISM: 45, FROST: 48,
};

function attr(feature: string, preset: string, eff: string, label: string): AttributeInfo {
  return { feature, preset, eff, effId: EFFECT_ID[eff] ?? 0, label };
}

/** gma1 attribute name -> its feature/preset/effect/label. */
export const GMA_ATTRIBUTE: Record<string, AttributeInfo> = {
  PAN: attr('PAN/TILT', 'PAN/TILT', 'PAN', 'Pan'),
  TILT: attr('PAN/TILT', 'PAN/TILT', 'TILT', 'Tilt'),
  DIM: attr('DIMMER', 'DIMMER', 'DIMMER', 'Dim'),
  RED: attr('RGB', 'COLOR', 'COLOR_MIX', 'R'),
  GREEN: attr('RGB', 'COLOR', 'COLOR_MIX', 'G'),
  BLUE: attr('RGB', 'COLOR', 'COLOR_MIX', 'B'),
  WHITE: attr('RGB', 'COLOR', 'COLOR_MIX', 'W'),
  COLORMIX1: attr('COLORMIX', 'COLOR', 'COLOR_MIX', 'CM1'),
  COLORMIX2: attr('COLORMIX', 'COLOR', 'COLOR_MIX', 'CM2'),
  COLORMIX3: attr('COLORMIX', 'COLOR', 'COLOR_MIX', 'CM3'),
  'COLOR1': attr('COLOR1', 'COLOR', 'COLOR', 'C1'),
  'COLOR1 CORR': attr('COLOR1', 'COLOR', 'COLOR', 'C1 Corr'),
  GOBO1: attr('GOBO1', 'GOBO', 'GOBO', 'G1'),
  'GOBO1 ROT': attr('GOBO1', 'GOBO', 'GOBO_ROTATE', 'G1 Rot'),
  GOBO2: attr('GOBO2', 'GOBO', 'GOBO', 'G2'),
  'GOBO2 ROT': attr('GOBO2', 'GOBO', 'GOBO_ROTATE', 'G2 Rot'),
  STROBE: attr('BEAM1', 'BEAM', 'STROBE', 'Strb'),
  IRIS: attr('BEAM1', 'BEAM', 'IRIS', 'Iris'),
  PRISMA1: attr('BEAM1', 'BEAM', 'PRISM', 'P1'),
  ZOOM: attr('FOCUS', 'BEAM', 'ZOOM', 'Zoom'),
  FOCUS: attr('FOCUS', 'BEAM', 'FOCUS', 'Focus'),
  FROST: attr('FOCUS', 'BEAM', 'FROST', 'Frost'),
  CONTROL: attr('CONTROL', 'CONTROL', 'NONE', 'Ctrl'),
};

/**
 * GDTF attribute name (or common alias) -> gma1 attribute name. Looked up case- and
 * separator-insensitively, so "color_wheel_1" matches "ColorWheel1". Only mappings that mean the
 * same thing on the console belong here; everything else becomes a control channel (buildType).
 */
export const GDTF_TO_GMA: Record<string, string> = {
  Pan: 'PAN', Tilt: 'TILT', Dimmer: 'DIM', Shutter1: 'STROBE', Strobe: 'STROBE',
  Zoom: 'ZOOM', Focus1: 'FOCUS', Focus: 'FOCUS', Iris: 'IRIS', Frost1: 'FROST', Frost: 'FROST',
  Prism1: 'PRISMA1', Prism1Pos: 'PRISMA1 POS', Prism1PosRotate: 'PRISMA1 ROT',
  Prism2: 'PRISMA2', Prism2Pos: 'PRISMA2 POS', Prism2PosRotate: 'PRISMA2 ROT',
  ColorAdd_R: 'RED', ColorAdd_G: 'GREEN', ColorAdd_B: 'BLUE',
  // Extra LED emitters, as patched on the console: white on CM4, amber on AMBER, UV on the first and
  // lime on the second colour wheel.
  ColorAdd_W: 'COLORMIX4', White: 'COLORMIX4', ColorAdd_A: 'AMBER', ColorAdd_RY: 'AMBER', Amber: 'AMBER',
  ColorAdd_UV: 'COLOR1', UV: 'COLOR1', ColorAdd_GY: 'COLOR2', ColorAdd_L: 'COLOR2', Lime: 'COLOR2',
  ColorRGB_Red: 'RED', ColorRGB_Green: 'GREEN', ColorRGB_Blue: 'BLUE',
  ColorSub_C: 'COLORMIX1', ColorSub_M: 'COLORMIX2', ColorSub_Y: 'COLORMIX3',
  CTO: 'COLOR1 CORR', CTC: 'COLOR1 CORR', CTB: 'COLOR1 CORR',
  Color1: 'COLOR1', ColorWheel1: 'COLOR1', ColorWheel: 'COLOR1', Color1WheelSpin: 'COLOR1 ROT',
  Color2: 'COLOR2', ColorWheel2: 'COLOR2', Color3: 'COLOR3', ColorWheel3: 'COLOR3',
  Gobo1: 'GOBO1', Gobo1Pos: 'GOBO1 POS', Gobo1PosRotate: 'GOBO1 ROT', Gobo1WheelSpin: 'GOBO1 WHEEL ROT',
  Gobo2: 'GOBO2', Gobo2Pos: 'GOBO2 POS', Gobo2PosRotate: 'GOBO2 ROT', Gobo2WheelSpin: 'GOBO2 WHEEL ROT',
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const GDTF_TO_GMA_NORMALIZED = new Map(Object.entries(GDTF_TO_GMA).map(([k, v]) => [normalize(k), v]));

/** Map a GDTF attribute to a gma1 attribute name (falls back to a spaced upper-case form). */
export function gmaAttributeName(gdtf: string): string {
  return GDTF_TO_GMA[gdtf] ?? GDTF_TO_GMA_NORMALIZED.get(normalize(gdtf))
    ?? gdtf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase();
}

/** gma1 attribute name -> a canonical GDTF attribute name (for MVR/GDTF export). */
export const GMA_TO_GDTF: Record<string, string> = {
  PAN: 'Pan', TILT: 'Tilt', DIM: 'Dimmer', STROBE: 'Shutter1', ZOOM: 'Zoom', FOCUS: 'Focus1',
  IRIS: 'Iris', FROST: 'Frost1', PRISMA1: 'Prism1', RED: 'ColorAdd_R', GREEN: 'ColorAdd_G',
  BLUE: 'ColorAdd_B', WHITE: 'ColorAdd_W', COLORMIX1: 'ColorSub_C', COLORMIX2: 'ColorSub_M',
  COLORMIX3: 'ColorSub_Y', 'COLOR1': 'Color1', 'COLOR1 CORR': 'CTO', GOBO1: 'Gobo1',
  'GOBO1 ROT': 'Gobo1PosRotate', GOBO2: 'Gobo2', 'GOBO2 ROT': 'Gobo2PosRotate', CONTROL: 'Control1',
};

/** GDTF attribute name for a gma1 attribute (falls back to a camel-case form). */
export function gdtfAttributeName(gma: string): string {
  if (GMA_TO_GDTF[gma]) return GMA_TO_GDTF[gma];
  return gma.toLowerCase().replace(/(^|[ _])([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/[ _]/g, '');
}
