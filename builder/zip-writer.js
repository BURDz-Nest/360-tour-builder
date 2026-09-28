/**
 * zip-writer.js — a tiny, dependency-free ZIP builder (STORE method only).
 *
 * WHY hand-rolled: this project has a hard "no CDN / no build step / no bundler"
 * rule (see ARCHITECTURE.md). Pulling in JSZip/fflate would break that. We only
 * need to *create* a flat ZIP of a handful of files, and our biggest entries are
 * JPEGs — which DEFLATE can't meaningfully shrink — so STORE (uncompressed) is
 * both simplest and honest. The whole spec we need fits in ~120 lines.
 *
 * Produces a standards-compliant ZIP (local headers + central directory + EOCD)
 * that Moodle / SCORM Cloud unzip happily. No ZIP64 (fine well under 4GB, and
 * our SCORM packages are capped far below that anyway).
 */

const encoder = new TextEncoder();

/** CRC-32 (IEEE) with a lazily-built lookup table. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Coerce string | Uint8Array | ArrayBuffer -> Uint8Array. */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return encoder.encode(String(data));
}

/**
 * Build a ZIP Blob from a list of { name, data } entries.
 * `name` is the in-zip path (forward slashes). `data` may be a string,
 * Uint8Array, or ArrayBuffer.
 * @param {{name:string, data:(string|Uint8Array|ArrayBuffer)}[]} entries
 * @returns {Blob}
 */
export function makeZip(entries) {
  const chunks = [];   // local file records (Uint8Array pieces)
  const central = [];  // central directory records
  let offset = 0;      // running offset for central-dir back-references

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = toBytes(entry.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // ---- Local file header (0x04034b50) ----
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version needed
    local.setUint16(6, 0x0800, true);    // flags: UTF-8 filename
    local.setUint16(8, 0, true);         // method: 0 = STORE
        local.setUint16(10, 0, true);        // mod time
    local.setUint16(12, 0, true);        // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);     // compressed size (== size for STORE)
    local.setUint32(22, size, true);     // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);        // extra field length

    const localHeader = new Uint8Array(local.buffer);
    chunks.push(localHeader, nameBytes, dataBytes);

    // ---- Central directory record (0x02014b50) ----
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);          // version made by
    cen.setUint16(6, 20, true);          // version needed
    cen.setUint16(8, 0x0800, true);      // flags: UTF-8
    cen.setUint16(10, 0, true);          // method: STORE
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true);          // extra length
    cen.setUint16(32, 0, true);          // comment length
    cen.setUint16(34, 0, true);          // disk number start
    cen.setUint16(36, 0, true);          // internal attrs
    cen.setUint32(38, 0, true);          // external attrs
    cen.setUint32(42, offset, true);     // offset of local header

    const centralHeader = new Uint8Array(cen.buffer);
    central.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);

  // ---- End of central directory (0x06054b50) ----
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);            // disk number
  eocd.setUint16(6, 0, true);            // disk with central dir
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);      // offset of central dir
  eocd.setUint16(20, 0, true);           // comment length

  return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], {
    type: "application/zip",
  });
}
