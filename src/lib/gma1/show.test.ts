import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { equalBytes } from './binary';
import { gunzip, readTar, writeTar } from './archive';
import { formatAddress, parseAddress } from './address';
import {
  BuildError, addFixtures, addLayer, appendableLayers, buildShow, docFromShow, removeFixture, templateFor,
  updateFixture,
} from './doc';
import { decodeFixture, readFixtureBlock } from './records';
import { loadShow } from './show';
import { parseMemberStrict } from './tree';

// gma1 factory demo shows are not part of the repo. Point GMA1_SAMPLES at a folder holding
// them (each as <name>.sho + <name>.tar.gz) to run these tests.
const SAMPLES = process.env.GMA1_SAMPLES ?? '';
const has = (name: string) => !!SAMPLES && existsSync(join(SAMPLES, `${name}.sho`));
const load = (name: string) =>
  loadShow(name, readFileSync(join(SAMPLES, `${name}.sho`)), readFileSync(join(SAMPLES, `${name}.tar.gz`)));
const reload = (name: string, r: { sho: Uint8Array; tgz: Uint8Array }) => loadShow(name, r.sho, r.tgz);

describe('addresses', () => {
  it('formats and parses line.slot', () => {
    expect(formatAddress(0)).toBe('1.001');
    expect(formatAddress(731)).toBe('2.220');
    expect(parseAddress('2.220')).toBe(731);
    expect(parseAddress('732')).toBe(731);
    expect(parseAddress('-')).toBe(-1);
    expect(parseAddress('65.1')).toBeNull();
    expect(parseAddress('1.513')).toBeNull();
  });
});

describe.skipIf(!has('act training'))('demo shows', () => {
  const shows = ['you like hog', 'act training', 'vpu demo show', 'video softedge demo', 'video4 demo', 'gma startshow'];

  it.each(shows.filter(has))('%s: loads, round-trips and rebuilds unchanged', (name) => {
    const show = load(name);
    // The console pads archives with a varying number of zero blocks, so compare entries.
    const entries = readTar(gunzip(readFileSync(join(SAMPLES, `${name}.tar.gz`))));
    const rewritten = readTar(writeTar(entries));
    expect(rewritten.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    rewritten.forEach((e, i) => {
      expect(equalBytes(e.header, entries[i].header), e.name).toBe(true);
      expect(equalBytes(e.data, entries[i].data), e.name).toBe(true);
    });
    const out = buildShow(docFromShow(show), { now: new Date(2026, 8, 10, 12) });
    const again = reload(name, out);
    for (const e of show.entries) {
      const other = again.entries.find((x) => x.name === e.name)!;
      if (e.name !== 'info') expect(equalBytes(other.data, e.data), e.name).toBe(true);
    }
  });

  it('opens a show from the archive alone, rebuilding the header from info', () => {
    const withSho = load('act training');
    const noSho = loadShow('act training', undefined, readFileSync(join(SAMPLES, 'act training.tar.gz')));
    expect(noSho.header.title).toBe(withSho.header.title);
    expect(noSho.header.version).toBe(withSho.header.version);
    expect(docFromShow(noSho).fixtures.length).toBe(50);
    // an export from the archive-only load still round-trips
    const out = buildShow(docFromShow(noSho));
    expect(docFromShow(reload('act training', out)).fixtures.length).toBe(50);
  });

  it('knows fixture type footprints', () => {
    expect(load('you like hog').types.map((t) => [t.name, t.breaks])).toEqual([
      ['Dimmer  8bit', [1]], ['VL3000SPOT 16BIT E', [28]],
    ]);
  });

  it('re-addresses and unpatches', () => {
    let doc = docFromShow(load('act training'));
    const f201 = doc.fixtures.find((f) => f.fixId === 201)!;
    const f420 = doc.fixtures.find((f) => f.fixId === 420)!;
    doc = updateFixture(doc, f201.key, { patch: [parseAddress('3.001')!] });
    doc = removeFixture(doc, f420.key);
    const after = docFromShow(reload('act training', buildShow(doc)));
    expect(after.fixtures.find((f) => f.fixId === 201)!.patch).toEqual([1024]);
    expect(after.fixtures.find((f) => f.fixId === 420)!.patch).toEqual([-1]);
    expect(after.fixtures.length).toBe(50);
  });

  it('rejects overlaps and line crossings', () => {
    let doc = docFromShow(load('act training'));
    const f201 = doc.fixtures.find((f) => f.fixId === 201)!;
    doc = updateFixture(doc, f201.key, { patch: [parseAddress('1.500')!] });
    expect(() => buildShow(doc)).toThrow(BuildError);
  });

  it('appends fixtures (copied and from type) to the last layer and a new layer', () => {
    const show = load('you like hog');
    let doc = docFromShow(show);
    const last = appendableLayers(doc).at(-1)!;
    const [withLayer, layer] = addLayer(doc, 'Added');
    doc = addFixtures(withLayer, [
      { layerKey: last.key, name: 'VL3K 13', fixId: 101, chanId: 0, typeIndex: 1, patch: [1024] },
      { layerKey: layer.key, name: 'Dim X', fixId: 0, chanId: 500, typeIndex: 0, patch: [1100] },
    ]);
    for (const fromType of [false, true]) {
      const out = buildShow(doc, { fromType });
      const again = reload('you like hog', out);
      expect(again.root.children.map((l) => l.children.length)).toEqual([12, 61, 1]);
      const added = again.root.children[1].children[60];
      expect(decodeFixture(added.head).name).toBe('VL3K 13');
      expect(readFixtureBlock(decodeFixture(added.head).block).fixId).toBe(101);
      expect(added.children.length).toBe(23);
      // channels made from the type equal those of an existing fixture of that type
      const template = templateFor(show, 1)!;
      added.children.forEach((c, i) => {
        const a = c.head.slice(); const b = template.children[i].head.slice();
        a.fill(0, 36, 38); b.fill(0, 36, 38);
        if (fromType) expect(equalBytes(a, b), `channel ${i}`).toBe(true);
      });
      const sho = new DataView(out.sho.buffer, out.sho.byteOffset, out.sho.byteLength);
      expect(sho.getUint32(show.header.countsOffset, true)).toBe(336 + 23 + 1);
      expect(sho.getUint32(show.header.countsOffset + 4, true)).toBe(74);
      parseMemberStrict(again.entries.find((e) => e.name === 'showrow')!.data, 'showrow');
    }
  });

  it.skipIf(!has('gma startshow'))('adds a layer to an empty show', () => {
    const show = load('gma startshow');
    expect(show.root.coll).toBe(true);
    const [doc] = addLayer(docFromShow(show), 'Stage');
    expect(reload('gma startshow', buildShow(doc)).root.children.length).toBe(1);
  });
});
