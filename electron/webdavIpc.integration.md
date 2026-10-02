# Desktop DAV and Markdown Integration

Worktree: `C:/Users/Li Cheng Xin/.codex/worktrees/gsm-p020-selective/GSM`.
Source reference: selective `git show v0.8.5:<path>`, not a snapshot merge.

## Main API

`src/services/electronProxy.ts` exports `ElectronAPI`, `DesktopDavRequest`,
`DesktopDavResult`, `supportsDesktopDav()` and
`desktopDavFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>`.
The global `Window.electronAPI` stays declared in this module; no shared types
file change is required.

Preload IPC is `webdavRequest(params)` / `webdavCancel(requestId)`, on
`webdav-request` / `webdav-cancel`. Both capabilities must exist.
Requests carry a unique renderer-generated ID, absolute HTTP(S) URL, DAV method,
optional string headers/body and optional timeout. The main process owns an
AbortController until the entire response body has been consumed.

Existing `electron/main.js` registration and preload changes were retained.
No origin, profile, AGY, MCP, HTMLReading, X or Telegram behavior was replaced.
Browser fetch and backend DAV proxy behavior were not migrated from upstream.
An interrupted desktop PUT is not automatically retried: its write outcome is
unknown even when the client successfully aborts.

Budgets: eight active requests per sender, 8 KiB URL, 8 KiB per request-header
value, 16 KiB total request/returned-header bytes, 64 MiB UTF-8 request/response
body, and a 1-300 second main deadline. Credential-bearing URL userinfo, hashes,
control characters, arbitrary methods/headers and cross-origin Destination are
rejected. Redirects fail closed. Proxy initialization failures never fall back
to an unproxied fetch.

## RSS Handoff

The main/batch owner integrates `extractInertRssHtml` from
`src/utils/inertRssHtml.ts` into both RSS description-processing blocks in
`src/services/githubApi.ts`:

```ts
readmeText = extractInertRssHtml(readmeText).text.replace(/\s+/g, ' ').trim();
```

It returns `{ text: string, links: string[] }`. It parses only into an inert
template and never inserts parsed nodes. Link strings are unvalidated authored
values; consumers must retain their existing URL validation. This helper is not
a sanitizer for rendering arbitrary HTML. `githubApi.ts` was deliberately not
edited by this worker. Final shared-worktree inspection confirmed the other
owner has imported this helper and replaced both RSS description extraction
blocks.

## Verification

Run in the isolated worktree with already installed dependencies:

```text
node --test electron/webdavIpc.test.js
node node_modules/vitest/vitest.mjs run src/services/electronProxy.test.ts src/services/webdavService.test.ts src/services/backendAdapter.test.ts src/components/MarkdownRenderer.test.tsx src/utils/imageDownload.test.ts src/utils/markdownResources.test.ts src/utils/inertRssHtml.test.ts
node electron/webdavIpc.fixture-runner.cjs
```

The fixture runner creates a unique `.webdav-fixture-*` directory directly in
this worktree, sets Electron's userData and sessionData before readiness, runs
hidden sandboxed/context-isolated windows, and deletes only that verified
temporary directory after Electron exits. It imports production preload and DAV
IPC, and bundles the actual Markdown/bridge/service/helper code using existing
esbuild. Store hydration is replaced with an in-memory test stub; translation
initialization is stubbed because standalone esbuild has no Vite glob transform.
No production main entry, tray, login, AGY process or MCP server is started.
Renderer external requests and main-process non-fixture DAV targets are blocked.

Real Electron checks cover inline credentials, HEAD/PROPFIND/MKCOL/PUT/GET,
response-body abort/timeout closing server connections, redirect rejection,
other-window denial, absent subframe API, file-origin automatic health silence,
configured loopback HTTP health probing, inert RSS
network silence, native dark/light source selection, lightbox/download currentSrc,
SVG extension mapping, unsafe srcset filtering and navigation cancellation.

No dependency install, package-script edit or commit was made. Until the main
owner adds the DAV Node test to an aggregate test script, run it explicitly.
Real NAS interoperability, configured HTTP/SOCKS proxy connectivity, packaging
and the full application profile are outside this isolated fixture's coverage.

## Owned Paths

- `electron/webdavIpc.js` and `electron/webdavIpc.test.js`
- Existing `electron/main.js` registration and `electron/preload.js` bridge
- `electron/webdavIpc.fixture.cjs`, `.fixture-runner.cjs`, `.fixture.renderer.tsx`
- `src/services/electronProxy.ts` and `.test.ts`
- `src/services/webdavService.ts` and `.test.ts`
- `src/services/backendAdapter.ts` (health only) and `.test.ts`
- `src/components/MarkdownRenderer.tsx` and `.test.tsx`
- `src/utils/sanitizeSchema.ts`
- `src/utils/markdownResources.ts` and `.test.ts`
- `src/utils/imageDownload.ts` and `.test.ts`
- `src/utils/inertRssHtml.ts` and `.test.ts`
