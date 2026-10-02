import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface Config {
  host: string;
  dataDir: string;
  port: number;
  apiSecret: string | null;
  encryptionKey: string;
  dbPath: string;
  nodeEnv: string;
}

/** Resolve the data directory path, creating it if it doesn't exist. */
function resolveDataDir(): string {
  const configured = process.env.DATA_DIR;
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('DATA_DIR must be an absolute path');
  }
  const dataDir = configured || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Normalize an encryption key to a 64-char hex string (32 bytes) suitable for AES-256.
 *
 * Backward compatibility:
 * - Valid 64-char hex string → returned as-is (no change for existing users)
 * - Short hex (e.g. 32 chars from `openssl rand -hex 16`) → SHA-256 derived
 * - Non-hex input (base64, plain text, too-long hex) → SHA-256 derived
 */
export function normalizeEncryptionKey(key: string): string {
  const trimmed = key.trim();

  // Already a valid 32-byte hex key — pass through unchanged
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }

  // Hex string but wrong length — derive via SHA-256 for deterministic 32-byte result
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    console.warn(`[config] ENCRYPTION_KEY is ${trimmed.length} hex chars (expected 64). Deriving 32-byte key via SHA-256. Previously encrypted data may need re-encryption.`);
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  }

  // Non-hex input (base64, plain text, etc.) — derive via SHA-256
  console.warn('[config] ENCRYPTION_KEY is not a valid hex string. Deriving 32-byte key via SHA-256.');
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

/**
 * Resolve the AES-256 encryption key from env var, key file, or auto-generation.
 * All non-standard formats are normalized to a 64-char hex string (32 bytes).
 */
function resolveEncryptionKey(dataDir: string): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return normalizeEncryptionKey(envKey);
  }

  const keyFilePath = process.env.ENCRYPTION_KEY_FILE || path.join(dataDir, '.encryption-key');
  if (process.env.ENCRYPTION_KEY_FILE && !path.isAbsolute(keyFilePath)) {
    throw new Error('ENCRYPTION_KEY_FILE must be an absolute path');
  }
  fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
  if (fs.existsSync(keyFilePath)) {
    const fileKey = fs.readFileSync(keyFilePath, 'utf-8').trim();
    const normalized = normalizeEncryptionKey(fileKey);
    // Persist normalized key so future startups (even without normalization) use the correct format
    if (normalized !== fileKey) {
      fs.writeFileSync(keyFilePath, normalized, { mode: 0o600 });
      console.log('[config] Normalized encryption key written back to its protected key file');
    }
    return normalized;
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 });
  console.log('[config] Generated a new encryption key and saved it to the key file');
  return newKey;
}

/** Load all server configuration from environment variables and defaults. */
function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const apiSecret = process.env.API_SECRET?.trim() || null;
  if (nodeEnv === 'production' && !apiSecret) {
    throw new Error('API_SECRET is required in production');
  }
  const port = Number(process.env.PORT || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const dataDir = resolveDataDir();

  return {
    host: process.env.HOST || '127.0.0.1',
    dataDir,
    port,
    apiSecret,
    encryptionKey: resolveEncryptionKey(dataDir),
    dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(dataDir, 'data.db'),
    nodeEnv,
  };
}

export const config = loadConfig();
