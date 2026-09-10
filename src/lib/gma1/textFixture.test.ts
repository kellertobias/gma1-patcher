import { describe, expect, it } from 'vitest';
import { buildGma1FixtureText, gma1FixtureFileName, isMover } from './textFixture';

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

describe('grandMA1 fixture text export', () => {
  it('emits a _FIXTURETYPE block with a channel type per attribute and a FINE for 16-bit', () => {
    const { text, missing } = buildGma1FixtureText({ name: 'LED Mover', manufacturer: 'Cameo', shortName: 'LM', mode, headMover: isMover(mode) });
    expect(missing).toEqual([]);
    expect(text).toContain('_FIXTURETYPE');
    expect(text).toContain('_NAME       "LED Mover"');
    expect(text).toContain('_MANUFAC    "Cameo"');
    expect(text).toContain('_HEADMOVER  YES');
    expect(text).toContain('_ATTRIBUT "DIM" _FEATURE "DIMMER" _PRESET "DIMMER"');
    expect(text).toContain('_ATTRIBUT "PAN" _FEATURE "PAN/TILT" _PRESET "PAN/TILT"');
    expect(text).toContain('_TYPE FINE'); // Pan is 16-bit
    // one coarse _CHANFUNC per attribute channel (6), plus the fine PAN chantype (no CHANFUNC)
    expect(text.match(/_CHANFUNC/g)!.length).toBe(6);
    expect(text.match(/_ATTRIBUT/g)!.length).toBe(7); // 6 coarse + 1 fine
  });

  it('reports attributes with no grandMA1 equivalent', () => {
    const { missing } = buildGma1FixtureText({
      name: 'X', manufacturer: 'Y', shortName: 'X',
      mode: { name: 'm', breaks: [1], channels: [{ attribute: 'SomethingWeird', dmxBreak: 1, offsets: [1] }] },
    });
    expect(missing.length).toBe(1);
  });

  it('builds the console library file name', () => {
    expect(gma1FixtureFileName('Cameo', 'RGB Par 6')).toBe('CAMEO@RGB PAR 6.TXT');
  });
});
