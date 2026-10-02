# Import / Release integration (#414 / #415 / #417)

This is the domain handoff history, not the final release verdict. Central
wiring, locale integration, commits and final validation are recorded in
[P0.2.0 validation](P0.2.0-validation.md) and the migration ledger. Earlier
concurrent failures below are retained as historical evidence.

Source: `git show v0.8.5:<path>`, tag
`245ee3107e8a2ba849ee6e04ffdd920d6e35ecea`. No full merge.
All manual implementation changes are in the shared isolated workspace.
No commits, dependency changes, version changes or user-data migration.
Existing partial code was audited and extended, not reverted.

## APIs and ownership

- `GitHubTokenPermissions` is a named export from
  `src/components/GitHubTokenPermissions.tsx`. Settings worker can import it
  into GeneralPanel as `<GitHubTokenPermissions heading={false} />`.
  This worker does not edit GeneralPanel or settings wiring.
  Login and backend GitHub-token setup both render the shared guide.
- `GitHubTokenPermissionError` is exported from `src/services/githubApi.ts`,
  with `name` and `status = 403`. Resource-not-accessible PAT/integration
  bodies classify as permission errors. Rate-limit headers/body take priority;
  generic forbidden, malformed JSON, network and auth errors keep their
  existing distinct paths. `starRepository` and `isRepositoryStarred` accept
  an optional `AbortSignal`.
- Main/desktop worker's `extractInertRssHtml` from `src/utils/inertRssHtml.ts`
  is imported by both Trending paths in `githubApi.ts`. Only embedded
  description HTML parsing changed: original fetch/proxy routes, pagination,
  detail hydration, metadata extraction and null repository descriptions
  are preserved. Do not replace this service wholesale during integration.
- `useBatchStarImport` passes the actual detail `id` to `addRepository`.
  Positive safe-integer validation rejects unusable IDs before Star.
  Main owns authoritative Store identity handling and reference repair.
- `useBatchStarHistory` exposes `accountId`, `generation`, `history`,
  `historyError`, `record(text, previousText?)`, `edit(previousText, text)`.
  Its synchronous Store subscription invalidates old callbacks on every
  account transition, including an away-and-back switch before React renders.
  Exact input text is stored locally, ten newest unique inputs per account;
  whitespace and Unicode are not normalized. Loading never previews or Stars.
- README uses a lazy wrapper around the existing complete ReadmeModal, retaining
  its whole-page translation, variants, Markdown and TOC. Only read-only
  name/URL/owner/branch fields are passed; no fabricated identity reaches Store.
  Chunk failures have a closable error boundary; the import selection survives.
- `buildReleaseFilterLinks(release)` returns the complete ordered uploaded,
  source and body-download list, preserving authenticated paths, MIME,
  asset IDs, download counts and version timestamps. Filtering and rendering
  in Timeline/list and RepositoryReleaseSheet use the same indices.
- `evaluateReleaseFilters(ids, filters, repoName, links, realAssets)` returns
  `{ matchesRelease, matchedLinkIndexes }`. Per-filter exclusion priority,
  cross-filter OR/index union, empty-rule protection and real-asset gating
  for exclusion-only keyword rules match the fixed tag. Edited persisted
  presets precede constants. Source suffixes are stripped for matching only;
  explicit source rules and real ZIP matches remain valid.
- ReleaseCard optional props: `matchedLinkIndexes?: ReadonlySet<number>` and
  `assetFilterResetKey?: string`. An omitted index set keeps previous behavior.
  Show-all is local, reset on filter definitions/selection and every account
  transition. Sheet uses the same filters with local show-all and pagination
  reset. Recommendations keep the full canonical Release when visible and
  are hidden while an active filter hides links, avoiding excluded downloads
  leaking through a second recommendation surface.

## Locale handoff

`import-release-locale-additions.json` is a two-step delta for all ten supported
languages: copy only `upstreamKeys` from the fixed tag's namespace files, then
deep-merge `additions[language][namespace]`. No locale files are owned here.
All added component keys have readable English defaults until main applies
the delta. Do not copy the upstream token-storage promise: storage/security
claims must be checked against the configured personal backend.

## Verification and remaining integration

Tests use fictitious accounts, in-memory browser storage and mocked GitHub
writes. Shared node_modules is a junction; final tests disable Vitest's cache
and use the runner config loader to avoid writing config bundles there.
Earlier test commands used default caching, so their generated dependency
cache was not fully isolated from the original node_modules. No cleanup was
attempted against that original directory. Source files and actual user data
there were not operated on; this is not a claim of zero cache writes.

Verified on 2026-10-02:

- `vitest run ... --maxWorkers=2 --no-cache --configLoader=runner` with
  `NODE_OPTIONS=--no-experimental-webstorage`: **22 files, 178 tests passed**.
  Scoped imports include BatchStarImportDialog/Readme, LoginScreen/token guide,
  ReleaseCard/Timeline/RepositoryReleaseSheet, existing ReadmeModal, both batch
  hooks, history storage, githubApi permissions/starStatus/main/readme/discovery/
  trendingDescription/Factory, assetFilters/releaseFilterLinks/downloadLinks
  and the main-owned inert RSS helper.
- ESLint on **26 touched implementation/test files**: exit 0, no warnings.
- `tsc -b --noEmit`: exit 0 for the shared workspace snapshot at final check.
  Earlier errors in other workers' incomplete files were not fixed here.
- `git diff --check` on touched tracked paths: exit 0.
- Locale delta validation: all **10 languages**, **270 fixed-tag keys**
  and **50 new values** exist and parse correctly. This validates the handoff,
  not application to the central locale files.
- Local integration server: `http://127.0.0.1:57056/`, PID `40196`,
  HTTP 200 verified. Vite is configured in memory, with its cache confined to
  this workspace's `output/import-release-vite-cache`. Electron was not
  started; no browser account login or real Star/sync operation was performed.

Central integration still owns locale application, settings import, identity
Store behavior, App wiring and release acceptance. An already dispatched
remote Star cannot be undone by abort; late results are discarded locally.
Backend sync already dispatched before a switch needs the central sync
layer's account-bound write protection. Real Electron/browser visual smoke,
live credentials and actual GitHub writes are not acceptance evidence from
these mocked tests.

The existing RepositoryReleaseSheet test contained invalid UTF-8 bytes in
comments. They were converted to replacement characters in UTF-8 solely so
apply_patch could edit the test; executable assertions were retained.
