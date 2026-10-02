'use strict';

// Read-only capability probe: never writes, clears, logs or persists payloads.
const { app, clipboard, ClipboardItem } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const outputRoot = path.resolve(__dirname, '../../output/plugin-clipboard-probe');
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'));
app.setPath('userData', path.join(output, 'userData'));
app.setPath('sessionData', path.join(output, 'sessionData'));
const known = new Set(['text/plain', 'text/html', 'text/rtf', 'image/png']);
const timeout = setTimeout(() => app.exit(1), 15000);

async function inspect() {
  const items = await clipboard.read();
  const capabilities = [];
  const fingerprint = [];
  for (let index = 0; index < items.length; index++) {
    for (const type of [...items[index].types].sort()) {
      const capability = { item: index, type, readableBlob: false, constructable: false, knownFormat: known.has(type) };
      try {
        const payload = await items[index].getType(type);
        capability.readableBlob = payload instanceof Blob;
        if (capability.readableBlob) {
          const bytes = Buffer.from(await payload.arrayBuffer());
          fingerprint.push([index, type, crypto.createHash('sha256').update(bytes).digest('hex')]);
          const constructed = new ClipboardItem({ [type]: payload });
          const retained = await constructed.getType(type);
          capability.constructable = retained instanceof Blob &&
            bytes.equals(Buffer.from(await retained.arrayBuffer()));
        }
      } catch {
        // API exceptions may include private clipboard details; do not emit them.
      }
      capabilities.push(capability);
    }
  }
  return { capabilities, fingerprint: JSON.stringify(fingerprint) };
}

app.whenReady().then(async () => {
  const first = await inspect();
  const second = await inspect();
  const result = {
    electron: process.versions.electron,
    output,
    mode: 'read-only',
    systemWrites: 0,
    systemClears: 0,
    types: first.capabilities,
    stableSnapshot: first.fingerprint === second.fingerprint &&
      JSON.stringify(first.capabilities) === JSON.stringify(second.capabilities),
    unknownOrUnreadableFormats: first.capabilities.some((entry) =>
      !entry.knownFormat || !entry.readableBlob || !entry.constructable),
    physicalRoundtripVerified: false,
  };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  clearTimeout(timeout);
  app.exit(0);
}).catch(() => {
  console.error('Read-only clipboard capability probe failed; no payload details emitted');
  clearTimeout(timeout);
  app.exit(1);
});
