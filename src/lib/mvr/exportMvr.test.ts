import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docFromShow } from '../gma1/doc';
import { loadShow } from '../gma1/show';
import { buildMvr } from './exportMvr';
import { parseGdtf } from './gdtf';
import { gdtfFileFor, parseMvr } from './mvr';

const SAMPLES = process.env.GMA1_SAMPLES ?? '';
const has = (name: string) => !!SAMPLES && existsSync(join(SAMPLES, `${name}.sho`));
const load = (name: string) =>
  loadShow(name, readFileSync(join(SAMPLES, `${name}.sho`)), readFileSync(join(SAMPLES, `${name}.tar.gz`)));

describe.skipIf(!has('act training'))('MVR export', () => {
  it('exports a scene and embedded GDTFs that re-parse to the same fixtures', () => {
    const doc = docFromShow(load('act training'));
    const { bytes, report } = buildMvr(doc);
    expect(report.fixtures).toBe(50);
    expect(report.types).toBe(4);

    const mvr = parseMvr(bytes);
    expect(mvr.fixtures.length).toBe(50);

    // Fixture 201 (VL1000AS 1) is patched at 1.201 -> absolute 200 (0-based) -> address 201 (1-based)
    const f201 = mvr.fixtures.find((f) => f.fixtureId === 201)!;
    expect(f201.addresses[0].address).toBe(200); // parseMvr returns 0-based

    // every referenced GDTF is embedded and parses, with a matching mode footprint
    for (const spec of new Set(mvr.fixtures.map((f) => f.gdtfSpec))) {
      const data = gdtfFileFor(mvr, spec)!;
      expect(data, spec).toBeDefined();
      const type = parseGdtf(data);
      expect(type.modes[0].channels.length).toBeGreaterThan(0);
    }
  });

  it('skips unpatched fixtures', () => {
    const doc = docFromShow(load('act training'));
    const f = doc.fixtures[0];
    const cleared = { ...doc, fixtures: doc.fixtures.map((x) => (x === f ? { ...x, patch: x.patch.map(() => -1) } : x)) };
    const { report } = buildMvr(cleared);
    expect(report.fixtures).toBe(49);
    expect(report.skipped.some((s) => s.includes(f.name))).toBe(true);
  });
});
