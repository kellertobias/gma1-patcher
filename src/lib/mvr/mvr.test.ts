import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseGdtf } from './gdtf';
import { gdtfFileFor, parseMvr, parseMvrAddress } from './mvr';

const gdtf = zipSync({
  'description.xml': strToU8(`<?xml version="1.0"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="Aurospot" ShortName="AS" LongName="Cameo Aurospot" Manufacturer="Cameo">
    <DMXModes>
      <DMXMode Name="20 channel" Geometry="Body">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1,2"><LogicalChannel Attribute="Pan"/></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="3,4"><LogicalChannel Attribute="Tilt"/></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="20"><LogicalChannel Attribute="Dimmer"/></DMXChannel>
          <DMXChannel DMXBreak="1" Offset=""><LogicalChannel Attribute="Virtual"/></DMXChannel>
        </DMXChannels>
      </DMXMode>
      <DMXMode Name="two breaks">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1"><LogicalChannel Attribute="Dimmer"/></DMXChannel>
          <DMXChannel DMXBreak="2" Offset="1,2"><LogicalChannel Attribute="Pan"/></DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`),
});

const mvr = zipSync({
  'GeneralSceneDescription.xml': strToU8(`<?xml version="1.0"?>
<GeneralSceneDescription verMajor="1" verMinor="6">
  <Scene><Layers>
    <Layer name="Truss 1" uuid="L1">
      <ChildList>
        <Fixture name="Spot 1" uuid="F1">
          <Matrix>{1,0,0}{0,1,0}{0,0,1}{1000,2000,6000}</Matrix>
          <GDTFSpec>Cameo@Aurospot.gdtf</GDTFSpec><GDTFMode>20 channel</GDTFMode>
          <FixtureID>101</FixtureID><UnitNumber>1</UnitNumber>
          <Addresses><Address break="0">101</Address></Addresses>
        </Fixture>
        <GroupObject name="G" uuid="G1">
          <Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,1000}</Matrix>
          <ChildList>
            <Fixture name="Spot 2" uuid="F2">
              <Matrix>{1,0,0}{0,1,0}{0,0,1}{500,0,0}</Matrix>
              <GDTFSpec>Cameo@Aurospot</GDTFSpec><GDTFMode>20 channel</GDTFMode>
              <FixtureID>A</FixtureID><FixtureIDNumeric>102</FixtureIDNumeric>
              <Addresses><Address break="0">2.341</Address></Addresses>
            </Fixture>
          </ChildList>
        </GroupObject>
      </ChildList>
    </Layer>
  </Layers></Scene>
</GeneralSceneDescription>`),
  'Cameo@Aurospot.gdtf': gdtf,
});

describe('GDTF', () => {
  it('derives the footprint per break', () => {
    const t = parseGdtf(gdtf);
    expect(t.name).toBe('Aurospot');
    expect(t.modes.map((m) => [m.name, m.breaks])).toEqual([['20 channel', [20]], ['two breaks', [1, 2]]]);
  });
});

describe('MVR', () => {
  it('reads fixtures, addresses, IDs and positions', () => {
    const file = parseMvr(mvr);
    expect(file.fixtures.map((f) => [f.name, f.layer, f.fixtureId, f.addresses[0].address])).toEqual([
      ['Spot 2', 'Truss 1', 102, 852],
      ['Spot 1', 'Truss 1', 101, 100],
    ]);
    expect(file.fixtures[0].position).toEqual([0.5, 0, 1]);
    expect(gdtfFileFor(file, 'Cameo@Aurospot')).toBeDefined();
  });

  it('parses both address notations', () => {
    expect(parseMvrAddress('1')).toBe(0);
    expect(parseMvrAddress('513')).toBe(512);
    expect(parseMvrAddress('2.1')).toBe(512);
    expect(parseMvrAddress('x')).toBeNull();
  });
});
