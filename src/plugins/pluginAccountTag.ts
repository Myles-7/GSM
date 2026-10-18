// Cache only digests. Never retain credentials as map keys or persist them.
export async function resolvePluginAccountTag(token: string | null): Promise<string> {
  if (!token) return 'anon';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest)).slice(0, 8).map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // A fresh namespace prevents cross-account reuse even without WebCrypto.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `ephemeral:${Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
}
