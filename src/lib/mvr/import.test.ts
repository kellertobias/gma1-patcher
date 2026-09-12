import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addFixtureType, docFromShow } from '../gma1/doc';
import { buildFixtureType, channelsFromGdtf } from '../gma1/buildType';
import { loadShow } from '../gma1/show';
import { applyMvr, type MvrTypeGroup, type TypeChoice } from './import';
import type { MvrFixture } from './mvr';

const DIR = join(__dirname, '../../../public/blank');
const blank = () => loadShow('blank',
  new Uint8Array(readFileSync(join(DIR, 'blank.sho'))),
  new Uint8Array(readFileSync(join(DIR, 'blank.tar.gz'))));

const fixture = (name: string, id: number, layer: string, address: number): MvrFixture => ({
  uuid: `u${id}`, name, layer, gdtfSpec: 'x.gdtf', gdtfMode: 'm', fixtureId: id, unitNumber: 0,
  addresses: [{ dmxBreak: 0, address }], position: [0, 0, 0], rotation: [0, 0, 0],
} as MvrFixture);

/** Import `fixtures` of one GDTF type into an empty show and return the layers they landed in. */
function importedLayers(fixtures: MvrFixture[]) {
  const show = blank();
  const built = buildFixtureType({
    name: 'Dim', manufacturer: 'X', shortName: 'Dim', attributes: show.attributes,
    channels: channelsFromGdtf({ name: 'm', breaks: [1], channels: [{ attribute: 'Dimmer', dmxBreak: 1, offsets: [1] }] }),
  });
  const [doc, typeIndex] = addFixtureType(docFromShow(show), built.raw);
  const group: MvrTypeGroup = { key: 'k', spec: 'x.gdtf', mode: 'm', fixtures };
  const mapping: Record<string, TypeChoice> = { k: typeIndex };
  const [out, report] = applyMvr(doc, [group], mapping, { renameExisting: false, positions: false });
  expect(report.skipped).toEqual([]);
  return out.layers.map((l) => ({ name: l.name, fixtures: out.fixtures.filter((f) => f.layerKey === l.key).length }));
}

describe('MVR layers', () => {
  it('keeps the fixtures of one long-named layer together', () => {
    expect(importedLayers([
      fixture('a', 1, 'A layer name longer than the console allows', 0),
      fixture('b', 2, 'A layer name longer than the console allows', 1),
      fixture('c', 3, 'Short', 2),
    ])).toEqual([{ name: 'A layer name longe', fixtures: 2 }, { name: 'Short', fixtures: 1 }]);
  });

  it('keeps two layers apart when their names only differ past the name length', () => {
    expect(importedLayers([
      fixture('a', 1, '00000000-0000-4000-8100-000000000001', 0),
      fixture('b', 2, '00000000-0000-4000-8100-00000000000c', 1),
    ])).toEqual([{ name: '00000000-0000-4000', fixtures: 1 }, { name: '00000000-0000-4000', fixtures: 1 }]);
  });
});
