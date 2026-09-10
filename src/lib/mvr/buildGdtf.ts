import { zipSync } from 'fflate';
import { encodeLatin1, u32, view } from '../gma1/binary';
import type { RawFixtureType } from '../gma1/fixtureTypes';
import { gdtfAttributeName } from '../gma1/attributes';

/** A DMX channel of a grandMA1 fixture type, in slot order. */
export interface TypeChannel {
  attribute: string; // GDTF attribute name
  /** 1-based slot offsets: [coarse] or [coarse, fine]. */
  offsets: number[];
}

/** Channel kind from the 0x1C channel-type block (low nibble of the flags at +16): 0 coarse, 1 fine. */
function channelKind(block: Uint8Array): number {
  return u32(block, 16) & 0xf;
}

/**
 * Flatten a fixture type into DMX channels in slot order. Each coarse channel type takes the next
 * slot; a following fine channel type extends it to 16-bit. `attrName` maps a pretyp attribute index
 * to its grandMA1 name.
 */
export function typeChannels(type: RawFixtureType, attrName: (index: number) => string): TypeChannel[] {
  const channels: TypeChannel[] = [];
  let slot = 0;
  for (const ct of type.channelTypes) {
    slot += 1;
    if (channelKind(ct.block) === 1 && channels.length) {
      channels[channels.length - 1].offsets.push(slot);
    } else {
      channels.push({ attribute: gdtfAttributeName(attrName(ct.attribute)), offsets: [slot] });
    }
  }
  return channels;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build a minimal but valid GDTF (DIN SPEC 15800) for a grandMA1 fixture type: attribute definitions
 * for the attributes used, one geometry, and a single DMX mode with one DMX channel per grandMA1
 * channel. Enough for MVR consumers to place and address the fixture.
 */
export function buildGdtf(name: string, manufacturer: string, shortName: string, channels: TypeChannel[]): {
  fileName: string;
  bytes: Uint8Array;
} {
  const attrs = [...new Set(channels.map((c) => c.attribute))];
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
    `Manufacturer="${esc(manufacturer || 'grandMA1')}" Description="Exported from a grandMA1 show" ` +
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
    `    <Models>\n      <Model Name="Body" Length="0.3" Width="0.3" Height="0.3" PrimitiveType="Cube"/>\n    </Models>\n` +
    `    <Geometries>\n      <Geometry Name="Body" Model="Body" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}"/>\n    </Geometries>\n` +
    `    <DMXModes>\n` +
    `      <DMXMode Name="Default" Geometry="Body">\n` +
    `        <DMXChannels>\n${dmxChannels}\n        </DMXChannels>\n` +
    `        <Relations/>\n        <FTMacros/>\n` +
    `      </DMXMode>\n` +
    `    </DMXModes>\n` +
    `  </FixtureType>\n` +
    `</GDTF>\n`;
  const bytes = zipSync({ 'description.xml': encodeLatin1(xml) });
  const clean = (s: string) => s.replace(/[\\/:*?"<>|@]/g, ' ').trim();
  return { fileName: `${clean(manufacturer || 'grandMA1')}@${clean(name)}.gdtf`, bytes };
}

export { view };
