import 'server-only';

/**
 * Checks a ZIP-based file (such as .xlsx) before opening it, so a small upload cannot expand into
 * gigabytes ("zip bomb"). Reads only the archive's directory: entry count and declared sizes.
 */
export function assertSafeZip(buf: Uint8Array, opts: { maxEntries?: number; maxTotalBytes?: number; maxRatio?: number } = {}) {
  const maxEntries = opts.maxEntries ?? 2000;
  const maxTotal = opts.maxTotalBytes ?? 60 * 1024 * 1024;
  const maxRatio = opts.maxRatio ?? 200;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find the end-of-central-directory record (it is in the last 64 KB + 22 bytes).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid spreadsheet.');
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries > maxEntries) throw new Error('This spreadsheet has too many parts to open safely.');
  if (cdOffset + cdSize > buf.byteLength) throw new Error('This file is not a valid spreadsheet.');
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.byteLength || view.getUint32(p, true) !== 0x02014b50) throw new Error('This file is not a valid spreadsheet.');
    const compressed = view.getUint32(p + 20, true);
    const uncompressed = view.getUint32(p + 24, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('This spreadsheet is too large to open.');
    total += uncompressed;
    if (total > maxTotal) throw new Error('This spreadsheet is too large to open safely.');
    if (compressed > 0 && uncompressed / compressed > maxRatio && uncompressed > 1024 * 1024) throw new Error('This spreadsheet is compressed suspiciously and was not opened.');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    p += 46 + nameLen + extraLen + commentLen;
  }
}
