export interface ZipInputFile {
  path: string;
  content: Uint8Array | string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(v: number): [number, number] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v: number): [number, number, number, number] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * Pure TypeScript ZIP archive generator (PKZIP 2.0 STORE method, UTF-8 paths).
 * Works cleanly in both browser and Node.js without native dependencies.
 */
export function createZipArchive(files: ZipInputFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: number[] = [];
  const centralChunks: number[] = [];
  let offset = 0;

  for (const file of files) {
    const cleanPath = file.path.replace(/^\/+/, '');
    const nameBytes = encoder.encode(cleanPath);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes + filename)
    const localHeader = [
      0x50, 0x4b, 0x03, 0x04, // signature
      20, 0,                  // version needed
      0x00, 0x08,             // UTF-8 flag (bit 11)
      0, 0,                   // compression: 0 = STORE
      0, 0, 0, 0,             // mod time / date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0, 0,                   // extra length
    ];

    for (const b of localHeader) localChunks.push(b);
    for (const b of nameBytes) localChunks.push(b);
    for (let i = 0; i < data.length; i++) localChunks.push(data[i]);

    // Central directory header (46 bytes + filename)
    const centralHeader = [
      0x50, 0x4b, 0x01, 0x02, // signature
      20, 0,                  // version made by
      20, 0,                  // version needed
      0x00, 0x08,             // UTF-8 flag
      0, 0,                   // compression: STORE
      0, 0, 0, 0,             // mod time / date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0, 0,                   // extra len
      0, 0,                   // comment len
      0, 0,                   // disk number start
      0, 0,                   // internal attrs
      0, 0, 0, 0,             // external attrs
      ...u32(offset),         // local header offset
    ];

    for (const b of centralHeader) centralChunks.push(b);
    for (const b of nameBytes) centralChunks.push(b);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.length;
  const count = files.length;

  const eocd = [
    0x50, 0x4b, 0x05, 0x06,   // EOCD signature
    0, 0,                     // disk number
    0, 0,                     // central dir start disk
    ...u16(count),
    ...u16(count),
    ...u32(centralSize),
    ...u32(centralOffset),
    0, 0,                     // comment len
  ];

  const out = new Uint8Array(localChunks.length + centralChunks.length + eocd.length);
  out.set(localChunks, 0);
  out.set(centralChunks, localChunks.length);
  out.set(eocd, localChunks.length + centralChunks.length);
  return out;
}
