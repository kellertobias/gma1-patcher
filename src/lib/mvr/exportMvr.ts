import { zipSync } from 'fflate';
import { encodeLatin1 } from '../gma1/binary';
import { LINE_SIZE } from '../gma1/address';
import type { ShowDoc } from '../gma1/doc';
import { buildGdtf, typeChannels } from './buildGdtf';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Deterministic pseudo-UUID from a seed (so re-exports are stable). */
function uuid(seed: string): string {
  let h = 0x811c9dc5;
  const rand = () => {
    h = Math.imul(h ^ seed.charCodeAt(0), 0x01000193) >>> 0;
    seed = seed.slice(1) + String.fromCharCode((h & 0x7f) || 1);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const hex = (rand() + rand() + rand() + rand()).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Identity matrix with a metre offset, in MVR's "{u}{v}{w}{o}" millimetre form. */
function matrix(pos: [number, number, number] | undefined): string {
  const [x, y, z] = pos ?? [0, 0, 0];
  const mm = (v: number) => Math.round(v * 1000);
  return `{1.000000,0.000000,0.000000}{0.000000,1.000000,0.000000}{0.000000,0.000000,1.000000}` +
    `{${mm(x)}.000000,${mm(y)}.000000,${mm(z)}.000000}`;
}

export interface MvrExportReport {
  fixtures: number;
  types: number;
  skipped: string[];
}

/**
 * Export the show as an MVR scene: one MVR layer per grandMA1 layer, a Fixture per patched fixture,
 * and an embedded minimal GDTF per fixture type used. Unpatched fixtures and fixtures of a type that
 * has no channels are skipped.
 */
export function buildMvr(doc: ShowDoc): { bytes: Uint8Array; report: MvrExportReport } {
  const indexToName = new Map<number, string>();
  for (const [name, idx] of doc.show.attributes) if (!indexToName.has(idx)) indexToName.set(idx, name);
  const attrName = (idx: number) => indexToName.get(idx) ?? `ATTR${idx}`;

  const gdtfByType = new Map<number, { spec: string; bytes: Uint8Array }>();
  const files: Record<string, Uint8Array> = {};
  const skipped: string[] = [];

  const gdtfFor = (typeIndex: number): string | null => {
    if (gdtfByType.has(typeIndex)) return gdtfByType.get(typeIndex)!.spec;
    const raw = doc.show.fixtureTypePool.types[typeIndex];
    if (!raw) return null;
    const channels = typeChannels(raw, attrName);
    if (!channels.length) return null;
    const { fileName, bytes } = buildGdtf(raw.name, raw.manufacturer ?? 'grandMA1', raw.shortName ?? raw.name, channels);
    files[fileName] = bytes;
    gdtfByType.set(typeIndex, { spec: fileName, bytes });
    return fileName;
  };

  let fixtureCount = 0;
  const layersXml = doc.layers
    .map((layer) => {
      const fixtures = doc.fixtures.filter((f) => f.layerKey === layer.key);
      const fx = fixtures
        .map((f) => {
          const spec = gdtfFor(f.typeIndex);
          if (!spec) {
            skipped.push(`"${f.name}": fixture type has no exportable channels`);
            return null;
          }
          const address = f.patch.find((a) => a >= 0);
          if (address === undefined) {
            skipped.push(`"${f.name}": unpatched`);
            return null;
          }
          fixtureCount += 1;
          const abs = address + 1; // MVR addresses are 1-based
          const addr = `${Math.floor(address / LINE_SIZE) + 1}.${(address % LINE_SIZE) + 1}`;
          const fid = f.fixId > 0 ? f.fixId : f.chanId;
          return (
            `        <Fixture name="${esc(f.name)}" uuid="${uuid(`${layer.key}/${f.key}`)}">\n` +
            `          <Matrix>${matrix(f.position)}</Matrix>\n` +
            `          <GDTFSpec>${esc(spec)}</GDTFSpec>\n` +
            `          <GDTFMode>Default</GDTFMode>\n` +
            `          <Addresses><Address break="0">${abs}</Address></Addresses>\n` +
            `          <FixtureID>${fid}</FixtureID>\n` +
            `          <FixtureIDNumeric>${fid}</FixtureIDNumeric>\n` +
            `          <UnitNumber>0</UnitNumber>\n` +
            `          <CustomId>0</CustomId>\n` +
            `          <CustomIdType>0</CustomIdType>\n` +
            `          <Universe>${Math.floor(address / LINE_SIZE) + 1}</Universe>\n` +
            `          <!-- ${esc(addr)} -->\n` +
            `        </Fixture>`
          );
        })
        .filter(Boolean)
        .join('\n');
      if (!fx) return null;
      return (
        `    <Layer name="${esc(layer.name)}" uuid="${uuid(layer.key)}">\n` +
        `      <ChildList>\n${fx}\n      </ChildList>\n` +
        `    </Layer>`
      );
    })
    .filter(Boolean)
    .join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<GeneralSceneDescription verMajor="1" verMinor="6" provider="gma1-patcher">\n` +
    `  <Scene>\n` +
    `    <AUXData/>\n` +
    `    <Layers>\n${layersXml}\n    </Layers>\n` +
    `  </Scene>\n` +
    `</GeneralSceneDescription>\n`;

  files['GeneralSceneDescription.xml'] = encodeLatin1(xml);
  return {
    bytes: zipSync(files),
    report: { fixtures: fixtureCount, types: gdtfByType.size, skipped },
  };
}
