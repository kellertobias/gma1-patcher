import { strFromU8, unzipSync } from 'fflate';
import { list, xml } from './xml';

export interface GdtfChannel {
  attribute: string;
  dmxBreak: number;
  /** 1-based slots inside the break (coarse first); empty for virtual channels. */
  offsets: number[];
}

export interface GdtfMode {
  name: string;
  channels: GdtfChannel[];
  /** Slots per DMX break, breaks 1..n. */
  breaks: number[];
}

export interface GdtfType {
  name: string;
  shortName: string;
  longName: string;
  manufacturer: string;
  modes: GdtfMode[];
}

type Node = Record<string, unknown>;

function parseMode(m: Node): GdtfMode {
  const channels: GdtfChannel[] = list<Node>((m.DMXChannels as Node | undefined)?.DMXChannel).map((c) => {
    const rawBreak = String(c['@DMXBreak'] ?? '1');
    const offsets = String(c['@Offset'] ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const logical = list<Node>(c.LogicalChannel)[0];
    return {
      attribute: String(logical?.['@Attribute'] ?? c['@Name'] ?? ''),
      dmxBreak: rawBreak === 'Overwrite' ? 0 : Number(rawBreak) || 1,
      offsets,
    };
  });
  const maxBreak = Math.max(1, ...channels.map((c) => c.dmxBreak));
  const breaks = Array.from({ length: maxBreak }, (_, i) =>
    Math.max(0, ...channels.filter((c) => c.dmxBreak === i + 1).flatMap((c) => c.offsets)));
  return { name: String(m['@Name'] ?? ''), channels, breaks };
}

/** Parse a GDTF file (zip with description.xml). Only what the patch needs is read. */
export function parseGdtf(bytes: Uint8Array): GdtfType {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'description.xml' });
  const desc = files['description.xml'];
  if (!desc) throw new Error('not a GDTF file (no description.xml)');
  const ft = (xml.parse(strFromU8(desc)) as Node).GDTF as Node | undefined;
  const type = ft?.FixtureType as Node | undefined;
  if (!type) throw new Error('GDTF description has no FixtureType');
  return {
    name: String(type['@Name'] ?? ''),
    shortName: String(type['@ShortName'] ?? ''),
    longName: String(type['@LongName'] ?? ''),
    manufacturer: String(type['@Manufacturer'] ?? ''),
    modes: list<Node>((type.DMXModes as Node | undefined)?.DMXMode).map(parseMode),
  };
}
