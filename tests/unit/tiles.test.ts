import { describe, expect, it } from 'vitest';
import { decodeTile } from '../../scripts/lib/tiles.ts';

function paddedJson(value: unknown): Buffer {
  const source = Buffer.from(JSON.stringify(value));
  const length = Math.ceil(source.length / 8) * 8;
  const result = Buffer.alloc(length, 0x20);
  source.copy(result);
  return result;
}

function fixtureI3dm(): Buffer {
  const featureJson = paddedJson({
    INSTANCES_LENGTH: 1,
    RTC_CENTER: [1000, 2000, 3000],
    QUANTIZED_VOLUME_OFFSET: [10, 20, 30],
    QUANTIZED_VOLUME_SCALE: [100, 200, 300],
    POSITION_QUANTIZED: { byteOffset: 0 },
    SCALE_NON_UNIFORM: { byteOffset: 8 },
  });
  const featureBinary = Buffer.alloc(20);
  featureBinary.writeUInt16LE(0, 0);
  featureBinary.writeUInt16LE(32768, 2);
  featureBinary.writeUInt16LE(65535, 4);
  featureBinary.writeFloatLE(4, 8);
  featureBinary.writeFloatLE(5, 12);
  featureBinary.writeFloatLE(6, 16);
  const batchJson = paddedJson({ attributes: [{ 'gml:id': 'tree-1', wysokosc: '6' }] });
  const length = 32 + featureJson.length + featureBinary.length + batchJson.length;
  const tile = Buffer.alloc(length);
  tile.write('i3dm', 0, 'ascii');
  tile.writeUInt32LE(1, 4);
  tile.writeUInt32LE(length, 8);
  tile.writeUInt32LE(featureJson.length, 12);
  tile.writeUInt32LE(featureBinary.length, 16);
  tile.writeUInt32LE(batchJson.length, 20);
  tile.writeUInt32LE(0, 24);
  tile.writeUInt32LE(0, 28);
  featureJson.copy(tile, 32);
  featureBinary.copy(tile, 32 + featureJson.length);
  batchJson.copy(tile, 32 + featureJson.length + featureBinary.length);
  return tile;
}

describe('CMPT/I3DM decoding', () => {
  it('decodes quantized ECEF positions, instance scale, and batch attributes', () => {
    const [instance] = decodeTile(fixtureI3dm());
    expect(instance.ecef[0]).toBe(1010);
    expect(instance.ecef[1]).toBeCloseTo(2120.002, 2);
    expect(instance.ecef[2]).toBe(3330);
    expect(instance.scale).toEqual([4, 5, 6]);
    expect(instance.attributes['gml:id']).toBe('tree-1');
  });

  it('recursively unwraps a composite tile', () => {
    const inner = fixtureI3dm();
    const composite = Buffer.alloc(16 + inner.length * 2);
    composite.write('cmpt', 0, 'ascii');
    composite.writeUInt32LE(1, 4);
    composite.writeUInt32LE(composite.length, 8);
    composite.writeUInt32LE(2, 12);
    inner.copy(composite, 16);
    inner.copy(composite, 16 + inner.length);
    expect(decodeTile(composite)).toHaveLength(2);
  });
});
