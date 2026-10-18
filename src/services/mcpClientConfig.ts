export function codexOrganizationConfig(url: string, token: string) {
  return `[mcp_servers.gsm-local]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\n`;
}
export function createLocalMcpToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `gsm_mcp_${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
}
