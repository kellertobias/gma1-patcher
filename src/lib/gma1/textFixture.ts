import { GMA_ATTRIBUTE } from './attributes';
import type { GmaChannel } from './buildType';
import type { ShowAttribute } from './pretypPool';

/**
 * Export a fixture as a grandMA1 fixture-library file (the `_FIXTURETYPE { … }` text the console
 * imports). One `_CHANTYPE` per channel, plus a `_TYPE FINE` channel type for 16-bit channels.
 *
 * Feature/preset/label come from the loaded show's attribute definitions when available (so they
 * match that grandMA1 exactly), falling back to a built-in vocabulary for common attributes.
 */
export interface TextFixtureInput {
  name: string;
  manufacturer: string;
  shortName: string;
  comment?: string;
  headMover?: boolean;
  channels: GmaChannel[];
  /** Attribute definitions from the show's pretyp (name -> feature/preset/pretty). */
  attributeInfo?: Map<string, ShowAttribute>;
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

interface Vocab {
  feature: string;
  preset: string;
  label: string;
  eff: string;
}

function vocab(attr: string, info?: Map<string, ShowAttribute>): Vocab {
  const shown = info?.get(attr);
  const builtin = GMA_ATTRIBUTE[attr];
  return {
    feature: shown?.feature ?? builtin?.feature ?? attr,
    preset: shown?.preset ?? builtin?.preset ?? attr,
    label: builtin?.label ?? shown?.pretty ?? attr,
    eff: builtin?.eff ?? 'NONE',
  };
}

function channelTypeLines(c: GmaChannel, info?: Map<string, ShowAttribute>): string[] {
  const v = vocab(c.attribute, info);
  const head =
    `\t{ _ATTRIBUT ${q(c.attribute)} _FEATURE ${q(v.feature)} _PRESET ${q(v.preset)}` +
    ` _ATT_LABEL ${q(v.label)} _FEA_LABEL ${q(v.feature)}`;
  const coarse =
    `${head} _ETIME 0.000000 \t\t_CHANFUNC\n` +
    `\t\t{ _NAME ${q(v.label)} _RANGE [  0,255] _EFF ${v.eff} _PHYS [    0.00,    1.00] }\n\t}`;
  return c.sixteenBit ? [coarse, `${head} _TYPE FINE }`] : [coarse];
}

export function buildGma1FixtureText(input: TextFixtureInput): { text: string; missing: string[] } {
  const missing = input.attributeInfo
    ? [...new Set(input.channels.map((c) => c.attribute).filter((a) => !input.attributeInfo!.has(a) && !GMA_ATTRIBUTE[a]))]
    : [...new Set(input.channels.map((c) => c.attribute).filter((a) => !GMA_ATTRIBUTE[a]))];
  const chunks = input.channels.flatMap((c) => channelTypeLines(c, input.attributeInfo));
  const text =
    `_FIXTURETYPE\n{\n` +
    `\t_NAME       ${q(input.name)}\n` +
    `\t_MANUFAC    ${q(input.manufacturer || 'GDTF')}\n` +
    `\t_SHORTNAME  ${q(input.shortName || input.name)}\n` +
    `\t_VERSION    ORIGINAL\n` +
    `\t_COMMENT    ${q(input.comment ?? 'Created in gma1-patcher')}\n` +
    (input.headMover ? `\t_HEADMOVER  YES\n` : '') +
    `\t_BRIGHTMINW 10000.000000\n\t_BRIGHTMAXW 10000.000000\n` +
    `\t_ANGLEMIN   15.000000\n\t_ANGLEMAX   30.000000\n` +
    `\t_CHANTYPE\n${chunks.join('\n')}\n}\n`;
  return { text, missing };
}

/** The console's library file name for a fixture: `<MAKER>@<NAME>.TXT` (upper case). */
export function gma1FixtureFileName(manufacturer: string, name: string): string {
  const clean = (s: string) => s.toUpperCase().replace(/[\\/:*?"<>|]/g, ' ').trim();
  return `${clean(manufacturer || 'GDTF')}@${clean(name)}.TXT`;
}

/** Is a fixture with both Pan and Tilt a mover? (for `_HEADMOVER`). */
export function isMover(channels: GmaChannel[]): boolean {
  const attrs = channels.map((c) => c.attribute);
  return attrs.includes('PAN') && attrs.includes('TILT');
}
