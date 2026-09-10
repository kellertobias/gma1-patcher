import { describe, expect, it } from 'vitest';
import type { GmaChannel } from './buildType';
import { buildGma1FixtureText, gma1FixtureFileName, isMover } from './textFixture';

const channels: GmaChannel[] = [
  { attribute: 'DIM', sixteenBit: false, dmxBreak: 1 },
  { attribute: 'RED', sixteenBit: false, dmxBreak: 1 },
  { attribute: 'GREEN', sixteenBit: false, dmxBreak: 1 },
  { attribute: 'BLUE', sixteenBit: false, dmxBreak: 1 },
  { attribute: 'PAN', sixteenBit: true, dmxBreak: 1 },
  { attribute: 'TILT', sixteenBit: false, dmxBreak: 1 },
];

describe('grandMA1 fixture text export', () => {
  it('emits a _FIXTURETYPE block with a channel type per attribute and a FINE for 16-bit', () => {
    const { text, missing } = buildGma1FixtureText({ name: 'LED Mover', manufacturer: 'Cameo', shortName: 'LM', channels, headMover: isMover(channels) });
    expect(missing).toEqual([]);
    expect(text).toContain('_NAME       "LED Mover"');
    expect(text).toContain('_HEADMOVER  YES');
    expect(text).toContain('_ATTRIBUT "DIM" _FEATURE "DIMMER" _PRESET "DIMMER"');
    expect(text).toContain('_ATTRIBUT "PAN" _FEATURE "PAN/TILT" _PRESET "PAN/TILT"');
    expect(text).toContain('_TYPE FINE');
    expect(text.match(/_CHANFUNC/g)!.length).toBe(6);
    expect(text.match(/_ATTRIBUT/g)!.length).toBe(7); // 6 coarse + 1 fine
  });

  it('reports attributes with no grandMA1 vocabulary', () => {
    const { missing } = buildGma1FixtureText({
      name: 'X', manufacturer: 'Y', shortName: 'X',
      channels: [{ attribute: 'SOMETHINGWEIRD', sixteenBit: false, dmxBreak: 1 }],
    });
    expect(missing).toEqual(['SOMETHINGWEIRD']);
  });

  it('builds the console library file name', () => {
    expect(gma1FixtureFileName('Cameo', 'RGB Par 6')).toBe('CAMEO@RGB PAR 6.TXT');
  });
});
