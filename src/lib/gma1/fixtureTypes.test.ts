import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { equalBytes } from './binary';
import { gunzip, readTar } from './archive';
import { parseAttributeIndex, parseFixtureTypePool, serializeFixtureTypePool } from './fixtureTypes';

const SAMPLES = process.env.GMA1_SAMPLES ?? '';
const has = (name: string) => !!SAMPLES && existsSync(join(SAMPLES, `${name}.sho`));
const member = (show: string, name: string) => {
  const entries = readTar(gunzip(readFileSync(join(SAMPLES, `${show}.tar.gz`))));
  return entries.find((e) => e.name.replace(/^\.\//, '') === name)!.data;
};

const SHOWS = ['you like hog', 'act training', 'vpu demo show', 'video softedge demo', 'video4 demo', 'gma startshow'];

describe.skipIf(!has('act training'))('fixture type pool', () => {
  it.each(SHOWS.filter(has))('%s: fixturetypes round-trips byte for byte', (show) => {
    const raw = member(show, 'fixturetypes');
    const pool = parseFixtureTypePool(raw);
    expect(equalBytes(serializeFixtureTypePool(pool), raw)).toBe(true);
  });

  it('reads the fixture types of you like hog', () => {
    const pool = parseFixtureTypePool(member('you like hog', 'fixturetypes'));
    expect(pool.types.map((t) => t.name)).toEqual(['Dimmer  8bit', 'VL3000SPOT 16BIT E']);
    const vl = pool.types[1];
    expect(vl.channelTypes.length).toBe(28);
    expect(vl.presets.length).toBeGreaterThan(0);
    // first channel type is the DIM coarse channel
    expect(vl.channelTypes[0].functions[0].name).toBe('Dimmer');
  });

  it('reads standard attribute indices from pretyp', () => {
    const attrs = parseAttributeIndex(member('act training', 'pretyp'));
    expect(attrs.get('PAN')).toBe(0);
    expect(attrs.get('TILT')).toBe(1);
    expect(attrs.get('DIM')).toBe(11);
    expect(attrs.get('RED')).toBeTypeOf('number');
  });

  it('builds a fixture type from a GDTF mode and patches fixtures of it', async () => {
    const { buildFixtureType, channelsFromGdtf } = await import('./buildType');
    const { addFixtureType, addFixtures, addLayer, buildShow, docFromShow } = await import('./doc');
    const { loadShow } = await import('./show');
    const raw = readFileSync;
    const base = join(SAMPLES, 'you like hog');
    const show = loadShow('you like hog', raw(`${base}.sho`), raw(`${base}.tar.gz`));
    const attrs = show.attributes;
    // A 16-bit mover: Pan(2)+Tilt(2)+Dimmer(1) = 5 slots.
    const mode = {
      name: 'test', breaks: [5],
      channels: [
        { attribute: 'Pan', dmxBreak: 1, offsets: [1, 2] },
        { attribute: 'Tilt', dmxBreak: 1, offsets: [3, 4] },
        { attribute: 'Dimmer', dmxBreak: 1, offsets: [5] },
      ],
    };
    const built = buildFixtureType({ name: 'Test Mover', manufacturer: 'GDTF', shortName: 'TM', channels: channelsFromGdtf(mode), attributes: attrs });
    expect(built.substituted).toEqual([]);

    const [doc0, typeIndex] = addFixtureType(docFromShow(show), built.raw);
    let doc = doc0;
    expect(doc.show.types[typeIndex].breaks).toEqual([5]);
    expect(doc.show.types[typeIndex].unknown).toBe(0);
    const [withLayer, layer] = addLayer(doc, 'Movers');
    doc = addFixtures(withLayer, [{ layerKey: layer.key, name: 'Mover 1', fixId: 900, chanId: 0, typeIndex, patch: [512] }]);

    const out = buildShow(doc);
    const again = loadShow('you like hog', out.sho, out.tgz);
    expect(again.types.map((t) => t.name)).toContain('Test Mover');
    const back = docFromShow(again);
    const mover = back.fixtures.find((f) => f.name === 'Mover 1')!;
    expect(mover.patch).toEqual([512]);
    expect(again.types[mover.typeIndex].breaks).toEqual([5]);
    // 3 coarse channels create 3 control channels (fine channels are DMX-only)
    const node = again.root.children.at(-1)!.children[0];
    expect(node.children.length).toBe(3);
  });
});
