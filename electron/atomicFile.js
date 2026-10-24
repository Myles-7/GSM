'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

/** Replace a durable file without unlinking its previous contents on failure. */
function writeFileAtomicSync(filename, data, {
  fileSystem = fs,
  platform = process.platform,
  wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
  options = { encoding: 'utf8', mode: 0o600 },
} = {}) {
  const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, data, options);
    for (let attempt = 0; ; attempt++) {
      try { fileSystem.renameSync(temporaryPath, filename); return; }
      catch (error) {
        // A Windows scanner may briefly hold the destination after a read.
        if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        wait(10 * (2 ** attempt));
      }
    }
  } catch (error) {
    try { fileSystem.unlinkSync(temporaryPath); } catch { /* Preserve the write error. */ }
    throw error;
  }
}
module.exports = { writeFileAtomicSync };
