import { GMA_ATTRIBUTE, gmaAttributeName } from './attributes';
import type { GdtfMode, GdtfType } from '../mvr/gdtf';

/**
 * Export a fixture as a grandMA1 fixture-library file (the `_FIXTURETYPE { … }` text the console
 * imports from a fixture library). One `_CHANTYPE` per GDTF channel, plus a `_TYPE FINE` channel type
 * for each extra offset (16/24-bit). This is the format under `newfixtures/<MAKER>/<MAKER>@<NAME>.TXT`.
 */
export interface TextFixtureInput {
  name: string;
  manufacturer: string;
  shortName: string;
  comment?: string;
  headMover?: boolean;
  mode: GdtfMode;
}

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

function channelTypeLines(gma: string, fine: boolean): string {
  const info = GMA_ATTRIBUTE[gma];
  const feature = info?.feature ?? gma;
  const preset = info?.preset ?? gma;
  const head =
    `\t{ _ATTRIBUT ${q(gma)} _FEATURE ${q(feature)} _PRESET ${q(preset)}` +
    (info ? ` _ATT_LABEL ${q(info.label)} _FEA_LABEL ${q(feature)}` : '');
  if (fine) return `${head} _TYPE FINE }`;
  const eff = info?.eff ?? 'NONE';
  return (
    `${head} _ETIME 0.000000 \t\t_CHANFUNC\n` +
    `\t\t{ _NAME ${q(info?.label ?? gma)} _RANGE [  0,255] _EFF ${eff} _PHYS [    0.00,    1.00] }\n` +
    `\t}`
  );
}

export function buildGma1FixtureText(input: TextFixtureInput): { text: string; missing: string[] } {
  const missing: string[] = [];
  const chunks: string[] = [];
  for (const c of input.mode.channels) {
    if (!c.offsets.length) continue;
    const gma = gmaAttributeName(c.attribute);
    if (!GMA_ATTRIBUTE[gma]) missing.push(`${c.attribute} → ${gma}`);
    chunks.push(channelTypeLines(gma, false));
    for (let i = 1; i < c.offsets.length; i++) chunks.push(channelTypeLines(gma, true));
  }
  const text =
    `_FIXTURETYPE\n{\n` +
    `\t_NAME       ${q(input.name)}\n` +
    `\t_MANUFAC    ${q(input.manufacturer || 'GDTF')}\n` +
    `\t_SHORTNAME  ${q(input.shortName || input.name)}\n` +
    `\t_VERSION    ORIGINAL\n` +
    `\t_COMMENT    ${q(input.comment ?? `Imported from GDTF (${input.mode.name})`)}\n` +
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

/** Does a fixture whose Pan/Tilt makes it a mover? (for `_HEADMOVER`). */
export function isMover(mode: GdtfMode): boolean {
  const names = mode.channels.map((c) => gmaAttributeName(c.attribute));
  return names.includes('PAN') && names.includes('TILT');
}

export function describeGdtf(t: GdtfType): string {
  return `${t.manufacturer} ${t.name}`.trim();
}
