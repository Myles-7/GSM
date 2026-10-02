'use strict';

const { createHash } = require('node:crypto');

// Fixture-only trust: these raw formats originate in the native read snapshot,
// never in renderer/plugin input. Production MIME permissions are unchanged.
const RESTORABLE_TYPES = new Set([
  'text/plain', 'text/html', 'text/rtf', 'image/png',
  'electron application/osclipboard;format="Chromium internal source RFH token"',
  'electron application/osclipboard;format="Chromium internal source URL"',
]);

async function readClipboardSnapshot({ clipboard, ClipboardItem }) {
  const source = await clipboard.read();
  const items = [];
  const types = [];
  const bytesByItem = [];
  const signatures = [];
  for (const entry of source) {
    const data = Object.create(null);
    const bytesByType = new Map();
    const signature = [];
    for (const type of [...entry.types].sort()) {
      const blob = await entry.getType(type);
      if (!(blob instanceof Blob)) throw new Error('Clipboard contains a non-Blob payload; no writes permitted');
      const bytes = Buffer.from(await blob.arrayBuffer());
      data[type] = blob;
      bytesByType.set(type, bytes);
      types.push(type);
      signature.push([type, bytes.length, createHash('sha256').update(bytes).digest('hex')]);
    }
    const savedItem = new ClipboardItem(data);
    for (const [type, bytes] of bytesByType) {
      const saved = await savedItem.getType(type);
      if (!(saved instanceof Blob) || !bytes.equals(Buffer.from(await saved.arrayBuffer()))) {
        throw new Error('Clipboard backup byte validation failed; no writes permitted');
      }
    }
    items.push(savedItem);
    bytesByItem.push(bytesByType);
    signatures.push(signature);
  }
  // Bytes and fingerprints stay in memory; callers must not log this object.
  return { items, types, bytesByItem, signature: JSON.stringify(signatures) };
}

function sameClipboardSnapshot(left, right) {
  return !!left && !!right && left.signature === right.signature;
}

function canRestoreClipboardSnapshot(snapshot) {
  return snapshot.types.every((type) => RESTORABLE_TYPES.has(type));
}

async function restoreClipboardSnapshot({ clipboard, original, owned }) {
  const current = await readClipboardSnapshot(clipboard);
  if (!sameClipboardSnapshot(current, owned)) return false;
  if (original.items.length) await clipboard.clipboard.write(original.items);
  else await clipboard.clipboard.clear();
  const restored = await readClipboardSnapshot(clipboard);
  if (!sameClipboardSnapshot(restored, original)) {
    throw new Error('Clipboard restoration did not preserve all original item/type bytes');
  }
  return true;
}

module.exports = {
  readClipboardSnapshot, sameClipboardSnapshot, canRestoreClipboardSnapshot, restoreClipboardSnapshot,
};
