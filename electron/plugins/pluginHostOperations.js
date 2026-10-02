'use strict';

const { protocolError } = require('./pluginProtocol');
const { validateFileName } = require('./pluginPageBridge');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function validImageSize(width, height) {
  return width >= 1 && height >= 1 && width <= 8192 && height <= 8192 && width * height <= 32_000_000;
}

function assertPngHeader(buffer) {
  // Bound the decoder's allocation before it sees compressed image content.
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 ||
      !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR' ||
      !validImageSize(buffer.readUInt32BE(16), buffer.readUInt32BE(20))) {
    throw protocolError('PLUGIN_CLIPBOARD_IMAGE_INVALID', 'Clipboard image must be a PNG within the image size budget');
  }
}

// Inject Electron APIs so tests never touch the real clipboard or user files.
function createPluginHostOperations({ clipboard, nativeImage, ClipboardItem, dialog, fs, path, getWindow }) {
  function assertCurrent(isCurrent) {
    if (typeof isCurrent !== 'function' || !isCurrent()) {
      throw protocolError('PLUGIN_PAGE_CLOSED', 'Plugin page session expired');
    }
  }
  return {
    clipboardWrite({ text, isCurrent }) {
      assertCurrent(isCurrent);
      return Promise.resolve(clipboard.writeText(text)).then(() => null);
    },
    clipboardWriteImage({ buffer, isCurrent }) {
      assertCurrent(isCurrent);
      assertPngHeader(buffer);
      const image = nativeImage.createFromBuffer(buffer);
      const { width, height } = image.getSize();
      if (image.isEmpty() || !validImageSize(width, height)) {
        throw protocolError('PLUGIN_CLIPBOARD_IMAGE_INVALID', 'Clipboard image payload is invalid or too large');
      }
      assertCurrent(isCurrent);
      if (typeof clipboard.writeImage === 'function') {
        return Promise.resolve(clipboard.writeImage(image)).then(() => null);
      }
      if (typeof ClipboardItem !== 'function' || typeof clipboard.write !== 'function') {
        throw protocolError('PLUGIN_CAPABILITY_UNAVAILABLE', 'Image clipboard is unavailable');
      }
      const item = new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) });
      return Promise.resolve(clipboard.write([item])).then(() => null);
    },
    async saveFile({ fileName, buffer, isCurrent }) {
      validateFileName(fileName);
      assertCurrent(isCurrent);
      const result = await dialog.showSaveDialog(getWindow(), {
        defaultPath: path.extname(fileName) ? fileName : `${fileName}.png`,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      assertCurrent(isCurrent);
      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.promises.writeFile(result.filePath, buffer);
      return { fileName: path.basename(result.filePath) };
    },
  };
}

module.exports = { createPluginHostOperations };
