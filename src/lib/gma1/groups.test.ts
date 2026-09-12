import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { equalBytes } from './binary';
import { gunzip, readTar } from './archive';
import { GROUP_SLOTS, isUsed, parseGroupPool, serializeGroupPool, withGroups } from './groups';
import { addFixtureType, addFixtures, addLayer, buildShow, docFromShow, plannedGroups } from './doc';
import { buildFixtureType, channelsFromGdtf } from './buildType';
import { loadShow } from './show';

const groupMember = (tgz: string) => readTar(gunzip(new Uint8Array(readFileSync(tgz)))).find((e) => e.name === 'group')!.data;
const BLANK = join(__dirname, '../../../public/blank/blank.tar.gz');

describe('group pool', () => {
  it('round-trips the bundled empty show byte for byte', () => {
    const data = groupMember(BLANK);
    const pool = parseGroupPool(data);
    expect(pool.slots.length).toBe(GROUP_SLOTS);
    expect(pool.slots.filter(isUsed)).toEqual([]);
    expect(pool.order.length).toBe(GROUP_SLOTS);
    expect(equalBytes(serializeGroupPool(pool), data)).toBe(true);
  });

  // A console save with real groups; not part of the repo (see README).
  it.skipIf(!existsSync('test.sho'))('round-trips a console show with groups byte for byte', () => {
    const data = groupMember('test.tar.gz');
    const pool = parseGroupPool(data);
    const used = pool.slots.filter(isUsed);
    expect(used.length).toBeGreaterThan(0);
    // the console writes named groups, unnamed ones with members, and named ones with no list at all
    expect(used.some((g) => g.name && g.fixtures?.length)).toBe(true);
    expect(used.some((g) => !g.name && g.fixtures?.length)).toBe(true);
    expect(equalBytes(serializeGroupPool(pool), data)).toBe(true);
  });

  it('fills free slots and keeps the existing groups', () => {
    const pool = parseGroupPool(groupMember(BLANK));
    const filled = withGroups(pool, [
      { name: 'Front Truss', fixtures: [0, 1, 2] },
      { name: 'A name that is far too long for the console', fixtures: [3] },
    ]);
    const out = parseGroupPool(serializeGroupPool(filled));
    expect(out.slots[0]).toMatchObject({ name: 'Front Truss', fixtures: [0, 1, 2] });
    expect(out.slots[1]!.name).toBe('A name that is far'); // 18 characters
    expect(out.slots.slice(2).some(isUsed)).toBe(false);
    expect(out.order).toEqual(pool.order);
  });
});

describe('groups from the patch', () => {
  const BLANK_SHO = join(__dirname, '../../../public/blank/blank.sho');

  /** An empty show with two layers: Stage (2 × LED, 1 × Dim) and Hall (1 × LED). */
  function patched() {
    const show = loadShow('blank', new Uint8Array(readFileSync(BLANK_SHO)), new Uint8Array(readFileSync(BLANK)));
    const type = (name: string, attrs: string[]) => buildFixtureType({
      name, manufacturer: 'X', shortName: name, attributes: show.attributes,
      channels: channelsFromGdtf({ name: 'm', breaks: [attrs.length], channels: attrs.map((a, i) => ({ attribute: a, dmxBreak: 1, offsets: [i + 1] })) }),
    }).raw;
    let [doc, led] = addFixtureType(docFromShow(show), type('LED', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B']));
    let dim: number;
    [doc, dim] = addFixtureType(doc, type('Dim', ['Dimmer']));
    const [d2, stage] = addLayer(doc, 'Stage');
    const [d3, hall] = addLayer(d2, 'Hall');
    const fx = (layerKey: string, name: string, fixId: number, typeIndex: number, address: number) =>
      ({ layerKey, name, fixId, chanId: 0, typeIndex, patch: [address] });
    return addFixtures(d3, [
      fx(stage.key, 'LED 1', 1, led, 0),
      fx(stage.key, 'LED 2', 2, led, 3),
      fx(stage.key, 'Dim 1', 3, dim, 6),
      fx(hall.key, 'LED 3', 4, led, 10),
    ]);
  }

  const written = (tgz: Uint8Array) =>
    parseGroupPool(readTar(gunzip(tgz)).find((e) => e.name === 'group')!.data)
      .slots.filter(isUsed).map((g) => [g.name, g.fixtures]);

  it('writes no groups by default', () => {
    const out = buildShow(patched());
    expect(out.groups).toBe(0);
    expect(written(out.tgz)).toEqual([]);
  });

  it('writes one group per layer, per type and per combination', () => {
    const out = buildShow(patched(), { groups: { layers: true, types: true, combos: true } });
    expect(out.groups).toBe(7);
    // fixtures are referenced by old index, in the order they were built
    expect(written(out.tgz)).toEqual([
      ['Stage', [0, 1, 2]],
      ['Hall', [3]],
      ['LED', [0, 1, 3]],
      ['Dim', [2]],
      ['Stage LED', [0, 1]],
      ['Stage Dim', [2]],
      ['Hall LED', [3]],
    ]);
  });

  it('writes only what the plan asks for', () => {
    expect(written(buildShow(patched(), { groups: { layers: true } }).tgz)).toEqual([['Stage', [0, 1, 2]], ['Hall', [3]]]);
    expect(written(buildShow(patched(), { groups: { types: true } }).tgz)).toEqual([['LED', [0, 1, 3]], ['Dim', [2]]]);
  });
});

describe('group names', () => {
  it('fits both parts of a combination into the name and keeps them unique', () => {
    const fixtures = [
      { layerKey: 'L1', layer: 'LED PAR Audience', type: 'ROOT PAR 6', oldIndex: 0 },
      { layerKey: 'L2', layer: 'LED PAR Auxilliary', type: 'ROOT PAR 6', oldIndex: 1 },
      { layerKey: 'L3', layer: 'Stage', type: 'MAC 250 Entour', oldIndex: 2 },
    ];
    const names = plannedGroups(fixtures, { combos: true }).map((g) => g.name);
    expect(names.every((n) => n.length <= 18)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['LED PAR A ROOT PAR', 'LED PAR A ROOT P 2', 'Stage MAC 250 Ento']);
  });
});

describe('layers with the same name', () => {
  it('still gives one group per layer', () => {
    const groups = plannedGroups([
      { layerKey: 'L1', layer: 'Wash', type: 'A7', oldIndex: 0 },
      { layerKey: 'L2', layer: 'Wash', type: 'A7', oldIndex: 1 },
    ], { layers: true });
    expect(groups).toEqual([{ name: 'Wash', fixtures: [0] }, { name: 'Wash 2', fixtures: [1] }]);
  });
});
