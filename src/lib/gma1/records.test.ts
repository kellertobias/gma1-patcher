import { describe, expect, it } from 'vitest';
import { eulerToQuaternion, quaternionToEuler, readFixtureBlock, writeFixtureBlock } from './records';

describe('position and rotation', () => {
  it('round-trips Euler angles through the quaternion', () => {
    for (const e of [[0, 0, 0], [90, 0, 0], [0, 45, 0], [0, 0, -30], [10, 20, 30]] as [number, number, number][]) {
      const back = quaternionToEuler(eulerToQuaternion(e));
      back.forEach((v, i) => expect(v).toBeCloseTo(e[i], 2));
    }
  });

  it('writes and reads position and rotation in a fixture block', () => {
    const block = new Uint8Array(0x5c);
    // start from identity rotation
    const out = writeFixtureBlock(block, { fixId: 5, chanId: 7, position: [1.5, -2, 3], rotation: [0, 90, 0] });
    const read = readFixtureBlock(out);
    expect(read.fixId).toBe(5);
    expect(read.chanId).toBe(7);
    expect(read.position[0]).toBeCloseTo(1.5, 4);
    expect(read.position[2]).toBeCloseTo(3, 4);
    expect(read.rotation[1]).toBeCloseTo(90, 2);
  });

  it('treats an all-zero quaternion as identity', () => {
    expect(readFixtureBlock(new Uint8Array(0x5c)).rotation).toEqual([0, 0, 0]);
  });
});
