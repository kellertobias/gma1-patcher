import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShowFiles } from '../../browser';
import { addFixtureType, addFixtures, addLayer, buildShow, docFromShow } from '../doc';
import { loadShow } from '../show';
import { buildFixtureType, channelsFromGdtf } from '../buildType';

// The bundled empty show is a static asset; read it directly instead of fetching.
const DIR = join(__dirname, '../../../../public/blank');
function bundledBlank(): ShowFiles {
  return {
    baseName: 'New Show',
    sho: new Uint8Array(readFileSync(join(DIR, 'New Show.sho'))),
    tgz: new Uint8Array(readFileSync(join(DIR, 'New Show.tar.gz'))),
  };
}

describe('bundled empty show', () => {
  it('is loadable and reports an empty patch with the standard attributes', () => {
    const files = bundledBlank();
    const show = loadShow(files.baseName, files.sho, files.tgz);
    expect(show.fixtureTypePool.types.length).toBe(0);
    expect(show.root.children.length).toBe(0);
    expect(show.attributes.get('PAN')).toBe(0);
    for (const a of ['TILT', 'DIM', 'RED', 'GREEN', 'BLUE', 'ZOOM', 'FOCUS']) {
      expect(show.attributes.get(a), a).toBeTypeOf('number');
    }
    expect(docFromShow(show).fixtures.length).toBe(0);
  });

  it('supports the full workflow: add a type, add fixtures, export, reload', () => {
    const files = bundledBlank();
    const show = loadShow(files.baseName, files.sho, files.tgz);
    const mode = {
      name: '7ch', breaks: [7],
      channels: [
        { attribute: 'Dimmer', dmxBreak: 1, offsets: [1] },
        { attribute: 'ColorAdd_R', dmxBreak: 1, offsets: [2] },
        { attribute: 'ColorAdd_G', dmxBreak: 1, offsets: [3] },
        { attribute: 'ColorAdd_B', dmxBreak: 1, offsets: [4] },
        { attribute: 'Pan', dmxBreak: 1, offsets: [5, 6] },
        { attribute: 'Tilt', dmxBreak: 1, offsets: [7] },
      ],
    };
    const built = buildFixtureType({ name: 'LED Mover', manufacturer: 'X', shortName: 'LM', channels: channelsFromGdtf(mode), attributes: show.attributes });
    expect(built.missing).toEqual([]);
    const [doc0, typeIndex] = addFixtureType(docFromShow(show), built.raw);
    expect(doc0.show.types[typeIndex].breaks).toEqual([7]);
    const [withLayer, layer] = addLayer(doc0, 'Stage');
    const doc = addFixtures(withLayer, [
      { layerKey: layer.key, name: 'LED 1', fixId: 1, chanId: 0, typeIndex, patch: [0] },
      { layerKey: layer.key, name: 'LED 2', fixId: 2, chanId: 0, typeIndex, patch: [7] },
    ]);
    const out = buildShow(doc);
    expect(out.fixtures).toBe(2);
    const again = docFromShow(loadShow('New Show', out.sho, out.tgz));
    expect(again.fixtures.map((f) => f.name)).toEqual(['LED 1', 'LED 2']);
    expect(again.fixtures.map((f) => f.patch)).toEqual([[0], [7]]);
    expect(again.show.types[again.fixtures[0].typeIndex].name).toBe('LED Mover');
  });
});
