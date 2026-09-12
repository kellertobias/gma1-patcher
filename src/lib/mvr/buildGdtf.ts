import { zipSync } from 'fflate';
import { encodeLatin1, u32, view } from '../gma1/binary';
import type { RawFixtureType } from '../gma1/fixtureTypes';
import { gdtfAttributeName } from '../gma1/attributes';
import { type FixtureLook, fixtureLook, symbolSvg } from './symbols';

/** A DMX channel of a gma1 fixture type, in slot order. */
export interface TypeChannel {
  attribute: string; // GDTF attribute name
  /** 1-based slot offsets: [coarse] or [coarse, fine]. */
  offsets: number[];
}

/** Invert flag of a channel type (bit 6 of the flags at +16). */
const INVERT = 1 << 6;
/** Inverted colour-mix channels carry LED emitters (the console's RGB convention), not CMY filters. */
const EMITTER_GDTF: Record<string, string> = {
  COLORMIX1: 'ColorAdd_R', COLORMIX2: 'ColorAdd_G', COLORMIX3: 'ColorAdd_B', COLORMIX4: 'ColorAdd_W',
};

/** Channel kind from the 0x1C channel-type block (low nibble of the flags at +16): 0 coarse, 1 fine. */
function channelKind(block: Uint8Array): number {
  return u32(block, 16) & 0xf;
}

/**
 * Flatten a fixture type into DMX channels in slot order. Each coarse channel type takes the next
 * slot; a following fine channel type extends it to 16-bit. `attrName` maps a pretyp attribute index
 * to its gma1 name.
 */
export function typeChannels(type: RawFixtureType, attrName: (index: number) => string): TypeChannel[] {
  const channels: TypeChannel[] = [];
  let slot = 0;
  for (const ct of type.channelTypes) {
    slot += 1;
    if (channelKind(ct.block) === 1 && channels.length) {
      channels[channels.length - 1].offsets.push(slot);
    } else {
      const gma = attrName(ct.attribute);
      const emitter = (u32(ct.block, 16) & INVERT) !== 0 ? EMITTER_GDTF[gma] : undefined;
      channels.push({ attribute: emitter ?? gdtfAttributeName(gma), offsets: [slot] });
    }
  }
  return channels;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * GDTF transform matrix: identity rotation with a translation (metres) in the last column, the
 * form the GDTF files in the wild use.
 */
function at(z: number): string {
  return `{1,0,0,0}{0,1,0,0}{0,0,1,${z.toFixed(6)}}{0,0,0,1}`;
}

/**
 * Models and geometries for a fixture: a body sized like the real thing, carrying the 2D plan
 * symbol used by CAD views, and a beam at its front face so the fixture emits light instead of
 * being an inert box. `symbol` is the name of the symbol resource inside the GDTF.
 */
function bodyXml(look: FixtureLook, symbol: string): { models: string; geometries: string } {
  const [l, w, h] = look.size;
  const lens = Math.min(l, w) * 0.8;
  const f = (v: number) => v.toFixed(6);
  const models =
    `      <Model Name="Body" Length="${f(l)}" Width="${f(w)}" Height="${f(h)}" ` +
    `PrimitiveType="${look.moving ? 'Head' : 'Conventional'}" File="${esc(symbol)}"/>\n` +
    `      <Model Name="Beam" Length="${f(lens)}" Width="${f(lens)}" Height="${f(lens / 4)}" PrimitiveType="Cylinder"/>`;
  // The beam sits at the bottom face of the body and emits along -Z, as a hung fixture does.
  const geometries =
    `      <Geometry Name="Body" Model="Body" Position="${at(0)}">\n` +
    `        <Beam Name="Beam" Model="Beam" Position="${at(-h / 2)}" LampType="${look.moving ? 'Discharge' : 'Halogen'}" ` +
    `BeamAngle="${look.beamAngle}" FieldAngle="${look.fieldAngle}" BeamRadius="${f(lens / 2)}" ` +
    `BeamType="${look.beamType}" ColorRenderingIndex="100"/>\n` +
    `      </Geometry>`;
  return { models, geometries };
}

/**
 * Build a minimal but valid GDTF (DIN SPEC 15800) for a gma1 fixture type: attribute definitions
 * for the attributes used, a body with a beam, a 2D plan symbol for CAD views, and a single DMX
 * mode with one DMX channel per gma1 channel.
 */
export function buildGdtf(name: string, manufacturer: string, shortName: string, channels: TypeChannel[]): {
  fileName: string;
  bytes: Uint8Array;
} {
  const attrs = [...new Set(channels.map((c) => c.attribute))];
  const look = fixtureLook(name, attrs);
  const symbol = 'symbol';
  const { models, geometries } = bodyXml(look, symbol);
  const attrDefs = attrs
    .map((a) => `      <Attribute Name="${esc(a)}" Pretty="${esc(a)}" ActivationGroup="" Feature="Control.Control"/>`)
    .join('\n');
  const dmxChannels = channels
    .map((c) => {
      const offset = c.offsets.join(',');
      const a = esc(c.attribute);
      return (
        `        <DMXChannel DMXBreak="1" Offset="${offset}" Geometry="Body" Highlight="None">\n` +
        `          <LogicalChannel Attribute="${a}" Master="None">\n` +
        `            <ChannelFunction Name="${a} 1" Attribute="${a}" DMXFrom="0/1" Default="0/1"/>\n` +
        `          </LogicalChannel>\n` +
        `        </DMXChannel>`
      );
    })
    .join('\n');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<GDTF DataVersion="1.2">\n` +
    `  <FixtureType Name="${esc(name)}" ShortName="${esc(shortName || name)}" LongName="${esc(name)}" ` +
    `Manufacturer="${esc(manufacturer || 'gma1')}" Description="Exported from a gma1 show" ` +
    `FixtureTypeID="00000000-0000-0000-0000-000000000000" RefFT="">\n` +
    `    <AttributeDefinitions>\n` +
    `      <ActivationGroups/>\n` +
    `      <FeatureGroups>\n` +
    `        <FeatureGroup Name="Control" Pretty="Control"><Feature Name="Control"/></FeatureGroup>\n` +
    `      </FeatureGroups>\n` +
    `      <Attributes>\n${attrDefs}\n      </Attributes>\n` +
    `    </AttributeDefinitions>\n` +
    `    <Wheels/>\n` +
    `    <PhysicalDescriptions/>\n` +
    `    <Models>\n${models}\n    </Models>\n` +
    `    <Geometries>\n${geometries}\n    </Geometries>\n` +
    `    <DMXModes>\n` +
    `      <DMXMode Name="Default" Geometry="Body">\n` +
    `        <DMXChannels>\n${dmxChannels}\n        </DMXChannels>\n` +
    `        <Relations/>\n        <FTMacros/>\n` +
    `      </DMXMode>\n` +
    `    </DMXModes>\n` +
    `  </FixtureType>\n` +
    `</GDTF>\n`;
  const bytes = zipSync({
    'description.xml': encodeLatin1(xml),
    [`models/svg/${symbol}.svg`]: encodeLatin1(symbolSvg(look)),
  });
  const clean = (s: string) => s.replace(/[\\/:*?"<>|@]/g, ' ').trim();
  return { fileName: `${clean(manufacturer || 'gma1')}@${clean(name)}.gdtf`, bytes };
}

export { view };
