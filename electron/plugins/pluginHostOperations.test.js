const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createPluginHostOperations } = require('./pluginHostOperations');
const { createCapabilityRouter } = require('./capabilityRouter');
const { validatePageCapabilityRequest, decodeBinary, validateFileName } = require('./pluginPageBridge');

function pngHeader(width, height) {
  const buffer = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('rejects invalid PNG headers and oversized IHDR before native decoding', () => {
  let decodes = 0;
  let writes = 0;
  const ops = createPluginHostOperations({
    clipboard: { writeImage: () => writes++ },
    nativeImage: { createFromBuffer: () => {
      decodes++;
      return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) };
    } },
  });
  const wrongSignature = pngHeader(1, 1);
  wrongSignature[0] = 0;
  const wrongChunk = pngHeader(1, 1);
  wrongChunk.write('IDAT', 12, 'ascii');
  const wrongLength = pngHeader(1, 1);
  wrongLength.writeUInt32BE(12, 8);
  for (const buffer of [
    Buffer.from('not png'), pngHeader(1, 1).subarray(0, 32),
    wrongSignature, wrongChunk, wrongLength,
    pngHeader(0, 1), pngHeader(1, 0), pngHeader(8193, 1),
    pngHeader(1, 8193), pngHeader(8192, 8192), pngHeader(0xffffffff, 1),
  ]) {
    assert.throws(() => ops.clipboardWriteImage({ buffer, isCurrent: () => true }), { code: 'PLUGIN_CLIPBOARD_IMAGE_INVALID' });
  }
  assert.equal(decodes, 0);
  assert.equal(writes, 0);
});

test('accepts PNG dimension boundaries and still rejects invalid decoded images', async () => {
  let size = { width: 8000, height: 4000 };
  let empty = false;
  let decodes = 0;
  let writes = 0;
  const ops = createPluginHostOperations({
    clipboard: { writeImage: () => writes++ },
    nativeImage: { createFromBuffer: () => {
      decodes++;
      return { isEmpty: () => empty, getSize: () => size };
    } },
  });
  assert.equal(await ops.clipboardWriteImage({ buffer: pngHeader(8000, 4000), isCurrent: () => true }), null);
  size = { width: 8192, height: 1 };
  assert.equal(await ops.clipboardWriteImage({ buffer: pngHeader(8192, 1), isCurrent: () => true }), null);
  size = { width: 8193, height: 1 };
  assert.throws(() => ops.clipboardWriteImage({ buffer: pngHeader(1, 1), isCurrent: () => true }), { code: 'PLUGIN_CLIPBOARD_IMAGE_INVALID' });
  size = { width: 1, height: 1 };
  empty = true;
  assert.throws(() => ops.clipboardWriteImage({ buffer: pngHeader(1, 1), isCurrent: () => true }), { code: 'PLUGIN_CLIPBOARD_IMAGE_INVALID' });
  assert.equal(decodes, 4);
  assert.equal(writes, 2);
});

test('validates canonical base64 and portable filenames before host output', () => {
  for (const value of ['', 'a', 'Zg=', 'Zh==', '====', 'data:image/png;base64,Zg==', 'Zg==\n']) {
    assert.throws(() => decodeBinary(value), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
  }
  assert.equal(decodeBinary('Zg==').toString(), 'f');
  for (const name of ['../file', 'C:\\file', 'file.', 'nul.png', 'CON', '.hidden', 'file\0name', ' file.png', 'file/name']) {
    assert.throws(() => validateFileName(name), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
  }
  assert.equal(validateFileName('中文-card.png'), '中文-card.png');
});

test('enforces the 10 MiB encoded JSON boundary', () => {
  const overhead = Buffer.byteLength(JSON.stringify({ dataBase64: '' }));
  const length = Math.floor((10 * 1024 * 1024 - overhead) / 4) * 4;
  const request = { pluginId: 'com.example.page', pageId: 'one', method: 'clipboard.writeImage', args: { dataBase64: 'AAAA'.repeat(length / 4) } };
  assert.equal(validatePageCapabilityRequest(request).operation, 'writeImage');
  request.args.dataBase64 += 'AAAA';
  assert.throws(() => validatePageCapabilityRequest(request), { code: 'PLUGIN_PAGE_REQUEST_TOO_LARGE' });
});

test('clipboard and downloads require their own permissions', async () => {
  let called = 0;
  const router = createCapabilityRouter({ hostOperations: {
    clipboardWriteImage: () => { called++; },
    saveFile: () => { called++; },
  } });
  const image = { capability: 'clipboard', operation: 'writeImage', args: { dataBase64: 'Zg==' } };
  await assert.rejects(router.handle(['downloads:create'], image), { code: 'PLUGIN_PERMISSION_DENIED' });
  await router.handle(['clipboard:write'], image);
  const save = { capability: 'downloads', operation: 'saveFile', args: { fileName: 'image.png', dataBase64: 'Zg==' } };
  await assert.rejects(router.handle(['clipboard:write'], save), { code: 'PLUGIN_PERMISSION_DENIED' });
  await router.handle(['downloads:create'], save);
  assert.equal(called, 2);
});

test('invalid images and expired save dialogs never write host state', async () => {
  let current = true;
  let writes = 0;
  let dialogResult = { canceled: true };
  const options = {
    path, getWindow: () => null,
    clipboard: { writeText: () => writes++, writeImage: () => writes++ },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }) },
    fs: { promises: { writeFile: async () => writes++ } },
    dialog: { showSaveDialog: async () => dialogResult },
  };
  const ops = createPluginHostOperations(options);
  assert.throws(() => ops.clipboardWriteImage({ buffer: Buffer.from('f'), isCurrent: () => current }), { code: 'PLUGIN_CLIPBOARD_IMAGE_INVALID' });
  assert.deepEqual(await ops.saveFile({ fileName: 'card.png', buffer: Buffer.from('f'), isCurrent: () => current }), { canceled: true });
  dialogResult = { canceled: false, filePath: '/fake/card.png' };
  options.dialog.showSaveDialog = async () => { current = false; return dialogResult; };
  await assert.rejects(ops.saveFile({ fileName: 'card.png', buffer: Buffer.from('f'), isCurrent: () => current }), { code: 'PLUGIN_PAGE_CLOSED' });
  assert.equal(writes, 0);
});

test('awaits modern Electron clipboard writes and encodes images as ClipboardItems', async () => {
  let finish;
  let completed = false;
  const items = [];
  const ops = createPluginHostOperations({
    clipboard: {
      writeText: () => new Promise((resolve) => { finish = resolve; }),
      write: async (value) => { items.push(...value); },
    },
    ClipboardItem: class { constructor(value) { this.value = value; } },
    nativeImage: { createFromBuffer: () => ({
      isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from('png'),
    }) },
  });
  const text = Promise.resolve(ops.clipboardWrite({ text: 'fixture', isCurrent: () => true })).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  await text;
  assert.equal(await ops.clipboardWriteImage({ buffer: pngHeader(1, 1), isCurrent: () => true }), null);
  assert.equal(items.length, 1);
  assert.equal(items[0].value['image/png'].type, 'image/png');
  assert.equal(await items[0].value['image/png'].text(), 'png');
});
