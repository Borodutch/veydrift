// Minimal WebM (Matroska) and MP4 readers for test assertions: frame size,
// decoded-frame count, frame rate and duration, without ffprobe (not in CI).
export type VideoInfo = { width: number; height: number; frames: number; fps: number; duration: number };

function readUint(bytes: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[start + index]!;
  return value;
}

// EBML variable-length integer; IDs keep their length marker, sizes drop it.
function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = bytes[offset]!;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8) throw new Error("Invalid EBML vint");
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index]!;
    if (bytes[offset + index] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

const SEGMENT = 0x18538067, INFO = 0x1549a966, TRACKS = 0x1654ae6b, TRACK_ENTRY = 0xae, VIDEO = 0xe0, CLUSTER = 0x1f43b675,
  BLOCK_GROUP = 0xa0, TIMESTAMP_SCALE = 0x2ad7b1, DURATION = 0x4489, PIXEL_WIDTH = 0xb0, PIXEL_HEIGHT = 0xba,
  CLUSTER_TIMESTAMP = 0xe7, SIMPLE_BLOCK = 0xa3, BLOCK = 0xa1;
const containers = new Set([SEGMENT, INFO, TRACKS, TRACK_ENTRY, VIDEO, CLUSTER, BLOCK_GROUP]);

export function readWebm(bytes: Uint8Array): VideoInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let scale = 1_000_000, durationTicks = 0, width = 0, height = 0, clusterTime = 0;
  const timestamps: number[] = [];
  const walk = (start: number, end: number) => {
    let offset = start;
    while (offset < end) {
      const id = readVint(bytes, offset, true);
      const size = readVint(bytes, offset + id.length, false);
      const body = offset + id.length + size.length;
      const bodyEnd = size.unknown ? end : body + size.value;
      if (containers.has(id.value)) walk(body, bodyEnd);
      else if (id.value === TIMESTAMP_SCALE) scale = readUint(bytes, body, size.value);
      else if (id.value === DURATION) durationTicks = size.value === 4 ? view.getFloat32(body) : view.getFloat64(body);
      else if (id.value === PIXEL_WIDTH) width = readUint(bytes, body, size.value);
      else if (id.value === PIXEL_HEIGHT) height = readUint(bytes, body, size.value);
      else if (id.value === CLUSTER_TIMESTAMP) clusterTime = readUint(bytes, body, size.value);
      else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
        const track = readVint(bytes, body, false);
        timestamps.push(clusterTime + view.getInt16(body + track.length));
      }
      offset = bodyEnd;
    }
  };
  walk(0, bytes.length);
  timestamps.sort((a, b) => a - b);
  const span = (timestamps.at(-1)! - timestamps[0]!) * scale / 1e9;
  return { width, height, frames: timestamps.length, fps: (timestamps.length - 1) / span, duration: durationTicks * scale / 1e9 };
}

export function readMp4(bytes: Uint8Array): VideoInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = (start: number, end: number) => {
    const boxes: Array<{ type: string; body: number; end: number }> = [];
    for (let offset = start; offset < end;) {
      let size = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      let body = offset + 8;
      if (size === 1) { size = Number(view.getBigUint64(offset + 8)); body += 8; }
      if (size === 0) size = end - offset;
      boxes.push({ type, body, end: offset + size });
      offset += size;
    }
    return boxes;
  };
  const child = (parent: { body: number; end: number }, type: string) => {
    const box = children(parent.body, parent.end).find((candidate) => candidate.type === type);
    if (!box) throw new Error(`Missing MP4 box ${type}`);
    return box;
  };
  const moov = children(0, bytes.length).find((box) => box.type === "moov");
  if (!moov) throw new Error("Missing MP4 moov");
  const trak = children(moov.body, moov.end).find((box) => box.type === "trak"
    && String.fromCharCode(...bytes.subarray(child(child(box, "mdia"), "hdlr").body + 8, child(child(box, "mdia"), "hdlr").body + 12)) === "vide");
  if (!trak) throw new Error("Missing MP4 video track");
  const tkhd = child(trak, "tkhd");
  const mdia = child(trak, "mdia");
  const mdhd = child(mdia, "mdhd");
  const longTimes = bytes[mdhd.body] === 1;
  const timescale = view.getUint32(mdhd.body + (longTimes ? 20 : 12));
  const duration = longTimes ? Number(view.getBigUint64(mdhd.body + 24)) : view.getUint32(mdhd.body + 16);
  const stbl = child(child(mdia, "minf"), "stbl");
  const frames = view.getUint32(child(stbl, "stsz").body + 8);
  const stts = child(stbl, "stts");
  let ticks = 0, samples = 0;
  for (let entry = 0, count = view.getUint32(stts.body + 4); entry < count; entry += 1) {
    const sampleCount = view.getUint32(stts.body + 8 + entry * 8);
    samples += sampleCount;
    ticks += sampleCount * view.getUint32(stts.body + 12 + entry * 8);
  }
  return {
    width: view.getUint32(tkhd.end - 8) / 65536,
    height: view.getUint32(tkhd.end - 4) / 65536,
    frames,
    fps: samples / (ticks / timescale),
    duration: duration / timescale,
  };
}
