export interface DecodedTreeInstance {
  ecef: [number, number, number];
  scale: [number, number, number];
  attributes: Record<string, unknown>;
}

function readJson(buffer: Buffer, start: number, length: number): Record<string, unknown> {
  const text = buffer.subarray(start, start + length).toString('utf8').replace(/[\0\s]+$/g, '');
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function offsetOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const offset = (value as { byteOffset?: unknown }).byteOffset;
  return typeof offset === 'number' ? offset : undefined;
}

export function decodeI3dm(buffer: Buffer, start = 0): DecodedTreeInstance[] {
  if (buffer.subarray(start, start + 4).toString('ascii') !== 'i3dm') throw new Error('Expected i3dm tile');
  if (buffer.readUInt32LE(start + 4) !== 1) throw new Error('Unsupported i3dm version');
  const byteLength = buffer.readUInt32LE(start + 8);
  if (start + byteLength > buffer.length) throw new Error('Truncated i3dm tile');
  const featureJsonLength = buffer.readUInt32LE(start + 12);
  const featureBinaryLength = buffer.readUInt32LE(start + 16);
  const batchJsonLength = buffer.readUInt32LE(start + 20);
  const batchBinaryLength = buffer.readUInt32LE(start + 24);
  const featureJsonStart = start + 32;
  const featureBinaryStart = featureJsonStart + featureJsonLength;
  const batchJsonStart = featureBinaryStart + featureBinaryLength;
  const feature = readJson(buffer, featureJsonStart, featureJsonLength);
  const batch = readJson(buffer, batchJsonStart, batchJsonLength);
  const count = Number(feature.INSTANCES_LENGTH);
  if (!Number.isInteger(count) || count < 0) throw new Error('Invalid i3dm instance count');
  const rtc = (feature.RTC_CENTER as number[] | undefined) ?? [0, 0, 0];
  const quantizedOffset = (feature.QUANTIZED_VOLUME_OFFSET as number[] | undefined) ?? [0, 0, 0];
  const quantizedScale = (feature.QUANTIZED_VOLUME_SCALE as number[] | undefined) ?? [1, 1, 1];
  const quantizedPositionOffset = offsetOf(feature.POSITION_QUANTIZED);
  const positionOffset = offsetOf(feature.POSITION);
  const scaleOffset = offsetOf(feature.SCALE_NON_UNIFORM);
  if (quantizedPositionOffset === undefined && positionOffset === undefined) throw new Error('i3dm has no positions');
  const attributes = Array.isArray(batch.attributes) ? batch.attributes as Record<string, unknown>[] : [];
  const result: DecodedTreeInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const ecef: [number, number, number] = [0, 0, 0];
    for (let component = 0; component < 3; component += 1) {
      if (quantizedPositionOffset !== undefined) {
        const value = buffer.readUInt16LE(featureBinaryStart + quantizedPositionOffset + (index * 3 + component) * 2);
        ecef[component] = rtc[component] + quantizedOffset[component] + value / 65535 * quantizedScale[component];
      } else {
        ecef[component] = rtc[component] + buffer.readFloatLE(featureBinaryStart + (positionOffset ?? 0) + (index * 3 + component) * 4);
      }
    }
    const scale: [number, number, number] = scaleOffset === undefined
      ? [1, 1, 1]
      : [0, 1, 2].map((component) => buffer.readFloatLE(featureBinaryStart + scaleOffset + (index * 3 + component) * 4)) as [number, number, number];
    result.push({ ecef, scale, attributes: attributes[index] ?? {} });
  }
  void batchBinaryLength;
  return result;
}

export function decodeTile(buffer: Buffer): DecodedTreeInstance[] {
  const magic = buffer.subarray(0, 4).toString('ascii');
  if (magic === 'i3dm') return decodeI3dm(buffer);
  if (magic !== 'cmpt') throw new Error(`Unsupported 3D Tiles payload: ${magic}`);
  if (buffer.readUInt32LE(4) !== 1) throw new Error('Unsupported cmpt version');
  const byteLength = buffer.readUInt32LE(8);
  const tilesLength = buffer.readUInt32LE(12);
  if (byteLength > buffer.length) throw new Error('Truncated cmpt tile');
  const result: DecodedTreeInstance[] = [];
  let offset = 16;
  for (let index = 0; index < tilesLength; index += 1) {
    const innerLength = buffer.readUInt32LE(offset + 8);
    result.push(...decodeTile(buffer.subarray(offset, offset + innerLength)));
    offset += innerLength;
  }
  if (offset !== byteLength) throw new Error('Invalid cmpt byte length');
  return result;
}
