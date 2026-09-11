import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShowFiles } from '../../browser';
import { gunzip, readTar, writeTar } from '../archive';
import { addFixtureType, addFixtures, addLayer, buildShow, docFromShow } from '../doc';
import { loadShow, parseSho, showFileName } from '../show';
import { buildFixtureType, channelsFromGdtf } from '../buildType';

// The bundled empty show is a static asset; read it directly instead of fetching.
const DIR = join(__dirname, '../../../../public/blank');
function bundledBlank(): ShowFiles {
  return {
    baseName: 'New Show',
    sho: new Uint8Array(readFileSync(join(DIR, 'blank.sho'))),
    tgz: new Uint8Array(readFileSync(join(DIR, 'blank.tar.gz'))),
  };
}

/** Every tar header in the archive has a valid checksum (the console rejects the show otherwise). */
function tarHeadersValid(tgz: Uint8Array) {
  return readTar(gunzip(tgz)).map((e) => {
    const stored = new TextDecoder('latin1').decode(e.header.subarray(148, 156)).replace(/[\0 ]/g, '');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : e.header[i];
    return [e.name, stored !== '' && parseInt(stored, 8) === sum] as const;
  });
}

describe('fixture type from GDTF', () => {
  it('never skips a channel: missing or taken attributes become DUMMY (repeatable)', () => {
    const show = loadShow('blank', bundledBlank().sho, bundledBlank().tgz);
    const ch = (attribute: string, offsets: number[]) => ({ attribute, dmxBreak: 1, offsets });
    const mode = {
      name: 'test', breaks: [8],
      channels: [
        ch('Dimmer', [1]), ch('ColorAdd_W', [2]), ch('ColorAdd_UV', [3]), ch('color_wheel_1', [4]),
        ch('fixture_control', [5]), ch('position_movement', [6]), ch('ColorAdd_A', [7]), ch('Prism1PosRotate', [8]),
      ],
    };
    const built = buildFixtureType({ name: 'T', manufacturer: 'X', shortName: 'T', channels: channelsFromGdtf(mode), attributes: show.attributes });
    expect(built.raw.channelTypes.length).toBe(8);
    const nameOf = new Map([...show.attributes].map(([n, i]) => [i, n]));
    expect(built.raw.channelTypes.map((c) => nameOf.get(c.attribute)))
      .toEqual(['DIM', 'COLORMIX4', 'COLOR1', 'DUMMY', 'DUMMY', 'DUMMY', 'DUMMY', 'PRISMA1 ROT']);
    expect(built.substituted).toEqual([
      { from: 'color_wheel_1', to: 'DUMMY' }, // COLOR1 is taken by UV
      { from: 'fixture_control', to: 'DUMMY' },
      { from: 'position_movement', to: 'DUMMY' },
      { from: 'ColorAdd_A', to: 'DUMMY' }, // no AMBER attribute in the console's vocabulary
    ]);
  });
});

describe('showFileName', () => {
  it('keeps letters and digits, at most 5, lower case', () => {
    expect(showFileName('New Show')).toBe('newsh');
    expect(showFileName('test')).toBe('test');
    expect(showFileName('Ab-1_2 3xyz')).toBe('ab123');
    expect(showFileName('Größe')).toBe('gre');
    expect(showFileName(' -_ ')).toBe('show');
  });
});

describe('writeTar', () => {
  it('repairs a header whose checksum field is blank', () => {
    const [entry] = readTar(gunzip(bundledBlank().tgz));
    const header = entry.header.slice();
    header.fill(0x20, 148, 156);
    const [rewritten] = readTar(writeTar([{ ...entry, header }]));
    expect(rewritten.header).toEqual(entry.header);
  });
});

describe('bundled empty show', () => {
  it('is laid out like a console save', () => {
    const files = bundledBlank();
    for (const [name, ok] of tarHeadersValid(files.tgz)) expect(ok, `checksum of ${name}`).toBe(true);
    const entries = readTar(gunzip(files.tgz));
    expect(entries[0].name).toBe(''); // the console's root entry "./"
    expect(entries.some((e) => e.name.startsWith('DEFAULT.USER/'))).toBe(true);
    // Only the DEFAULT user profile ships; the console's own users are stripped.
    expect(entries.filter((e) => /\.USER\/$/.test(e.name)).map((e) => e.name)).toEqual(['DEFAULT.USER/']);
    expect(entries.find((e) => e.name === 'info')?.data).toEqual(files.sho);
  });

  it('is loadable and reports an empty patch with the standard attributes', () => {
    const files = bundledBlank();
    const show = loadShow(files.baseName, files.sho, files.tgz);
    expect(show.fixtureTypePool.types.length).toBe(0);
    expect(show.root.children.length).toBe(0);
    for (const a of ['PAN', 'TILT', 'DIM', 'RED', 'GREEN', 'BLUE', 'ZOOM', 'FOCUS']) {
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
    expect(built.substituted).toEqual([]);
    const [doc0, typeIndex] = addFixtureType(docFromShow(show), built.raw);
    expect(doc0.show.types[typeIndex].breaks).toEqual([7]);
    const [withLayer, layer] = addLayer(doc0, 'Stage');
    const doc = addFixtures(withLayer, [
      { layerKey: layer.key, name: 'LED 1', fixId: 1, chanId: 0, typeIndex, patch: [0] },
      { layerKey: layer.key, name: 'LED 2', fixId: 2, chanId: 0, typeIndex, patch: [7] },
    ]);
    const out = buildShow(doc);
    expect(out.fixtures).toBe(2);
    expect(out.baseName).toBe('newsh');
    expect(parseSho(out.sho)).toMatchObject({ title: 'NEWSH', fileName: 'newsh.sho', user: 'Administrator' });
    expect(buildShow(doc, { name: 'My Show #12' }).baseName).toBe('mysho');
    for (const [name, ok] of tarHeadersValid(out.tgz)) expect(ok, `checksum of ${name}`).toBe(true);
    const members = readTar(gunzip(out.tgz));
    expect(members.find((e) => e.name === 'info')?.data).toEqual(out.sho);
    // Filled pools must not keep the template's empty bit (bit 31 of the root PICID at offset 4).
    for (const name of ['showrow', 'fixturetypes']) {
      expect(members.find((e) => e.name === name)!.data[7] & 0x80, name).toBe(0);
    }
    const again = docFromShow(loadShow('New Show', out.sho, out.tgz));
    expect(again.fixtures.map((f) => f.name)).toEqual(['LED 1', 'LED 2']);
    expect(again.fixtures.map((f) => f.patch)).toEqual([[0], [7]]);
    expect(again.show.types[again.fixtures[0].typeIndex].name).toBe('LED Mover');
  });
});
