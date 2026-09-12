import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildGdtf, type TypeChannel } from './buildGdtf';
import { fixtureLook } from './symbols';

const ch = (attribute: string, offset: number): TypeChannel => ({ attribute, offsets: [offset] });

const files = (name: string, channels: TypeChannel[]) =>
  unzipSync(buildGdtf(name, 'gma1', name, channels).bytes);

describe('fixtureLook', () => {
  it('reads pan/tilt fixtures as moving lights, with gobos making them spots', () => {
    expect(fixtureLook('Foo', ['Pan', 'Tilt', 'Dimmer']).kind).toBe('movingWash');
    expect(fixtureLook('Foo', ['Pan', 'Tilt', 'Gobo1']).kind).toBe('movingSpot');
    // a moving light stays a moving light whatever the name suggests
    expect(fixtureLook('LED Par Mover', ['Pan', 'Tilt', 'ColorAdd_R']).kind).toBe('movingWash');
  });

  it('names the kind of a static fixture from the type name, else from its channels', () => {
    expect(fixtureLook('Dimmer Profile', ['Dimmer']).kind).toBe('profile');
    expect(fixtureLook('Dimmer Fresnel', ['Dimmer']).kind).toBe('fresnel');
    expect(fixtureLook('Dimmer PAR Can', ['Dimmer']).kind).toBe('par');
    expect(fixtureLook('LED Bar 12', ['Dimmer']).kind).toBe('bar');
    expect(fixtureLook('Atomic 3000', ['Dimmer']).kind).toBe('strobe');
    expect(fixtureLook('ACME X', ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B']).kind).toBe('ledPar');
    expect(fixtureLook('ACME X', ['Dimmer']).kind).toBe('par');
    expect(fixtureLook('Hazer', ['Control']).kind).toBe('generic');
  });
});

describe('buildGdtf', () => {
  it('ships a 2D plan symbol the body model points at', () => {
    const out = files('Mover', [ch('Pan', 1), ch('Tilt', 2), ch('Gobo1', 3)]);
    const desc = strFromU8(out['description.xml']);
    const symbol = /<Model Name="Body"[^>]*File="([^"]+)"/.exec(desc)?.[1];
    expect(symbol).toBeTruthy();
    const svg = out[`models/svg/${symbol}.svg`];
    expect(svg, 'symbol resource is embedded').toBeDefined();
    expect(strFromU8(svg)).toContain('<svg');
  });

  it('gives the body a beam and sizes it like the fixture kind', () => {
    const desc = strFromU8(files('Dimmer PAR Can', [ch('Dimmer', 1)])['description.xml']);
    const look = fixtureLook('Dimmer PAR Can', ['Dimmer']);
    expect(desc).toContain(`Length="${look.size[0].toFixed(6)}"`);
    expect(desc).toContain(`BeamAngle="${look.beamAngle}"`);
    expect(desc).toMatch(/<Beam Name="Beam"/);
  });

  it('keeps every DMX channel on the geometry the mode names', () => {
    const desc = strFromU8(files('Mover', [ch('Pan', 1), ch('Dimmer', 2)])['description.xml']);
    expect(desc).toContain('<DMXMode Name="Default" Geometry="Body">');
    expect([...desc.matchAll(/<DMXChannel [^>]*Geometry="([^"]+)"/g)].map((m) => m[1])).toEqual(['Body', 'Body']);
  });
});
