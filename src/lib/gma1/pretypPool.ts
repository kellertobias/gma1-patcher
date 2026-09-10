import { type Bytes, decodeLatin1, i32, u32 } from './binary';
import { parseMember } from './tree';

/** One grandMA1 attribute as defined in a show's `pretyp` pool. */
export interface ShowAttribute {
  name: string;
  pretty: string;
  /** Index referenced by channel types. */
  index: number;
  feature: string;
  preset: string;
}

// pretyp object tags: 0x11 root, 0x0f preset type, 0x0d feature, 0x0b attribute.
const TAG_PRESET_TYPE = 0x0f;
const TAG_FEATURE = 0x0d;
const TAG_ATTRIBUTE = 0x0b;

function fixString(head: Bytes, o: number): [string, number] {
  const n = u32(head, o);
  return [decodeLatin1(head.subarray(o + 4, o + 4 + n)), o + 4 + n];
}

/**
 * Read every attribute defined in a show's `pretyp`, with the feature and preset type it belongs to.
 * These are exactly the attributes a fixture in this show may reference — the fixture editor offers
 * only these.
 */
export function parseShowAttributes(pretyp: Bytes): Map<string, ShowAttribute> {
  const out = new Map<string, ShowAttribute>();
  const root = parseMember(pretyp).roots[0];
  if (!root) return out;
  for (const presetType of root.children) {
    if (presetType.tag !== TAG_PRESET_TYPE) continue;
    const [presetName] = fixString(presetType.head, 12); // PICID(4) + PICSTATUS(8)
    for (const feature of presetType.children) {
      if (feature.tag !== TAG_FEATURE) continue;
      const [featureName] = fixString(feature.head, 12);
      for (const attribute of feature.children) {
        if (attribute.tag !== TAG_ATTRIBUTE) continue;
        const [name, afterName] = fixString(attribute.head, 12);
        const [pretty, afterPretty] = fixString(attribute.head, afterName);
        const index = i32(attribute.head, afterPretty);
        if (!out.has(name)) out.set(name, { name, pretty, index, feature: featureName, preset: presetName });
      }
    }
  }
  return out;
}
