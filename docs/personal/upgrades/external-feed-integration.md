# External feed integration contract (#419)

This is the domain handoff history, not the final release verdict. Central
Store/Home wiring, v17 expectations and locale integration are complete in the
integrated source. Final verification supersedes earlier concurrent failures
below; see [P0.2.0 validation](P0.2.0-validation.md) and the migration ledger.

Authoritative upstream: v0.8.5 / 245ee3107e8a2ba849ee6e04ffdd920d6e35ecea.
Implementation is confined to the shared gsm-p020-selective workspace.

## Main-owned integration requested early

- `src/types/index.ts`: extend `DiscoveryChannelId` with
  `ExternalDiscoveryChannelId` from `src/types/externalFeed.ts`; extend
  `DiscoveryChannel` with `ExternalFeedConfiguration` (optional `sourceUrl`,
  `sourceKind`). `ExternalFeedKind` is `json | rss`; RSS includes Atom.
- Store API: `addExternalDiscoveryChannel(name: string, sourceUrl: string,
  kind?: ExternalFeedKind, expectedAccountId?: number): boolean`;
  `removeExternalDiscoveryChannel(id: DiscoveryChannelId): void`.
  The synchronous add must recheck current user ID, URL duplication and the
  ten-feed limit. `expectedAccountId`, when supplied, must match `state.user.id`.
  Never persist an unvalidated feed. Normalization helpers will be exported
  by `src/services/externalFeedConfig.ts`:
  `normalizeExternalDiscoveryChannels`, `normalizeDiscoveryFeedUrl`,
  `isExternalDiscoveryChannelId`, `normalizeExternalFeedKind`,
  `MAX_EXTERNAL_FEEDS = 10`.
- Keep feeds isolated in each account workspace. Normalize only the external
  entries, alongside preserved built-in channels. Remove must clear every
  per-channel repo/loading/error/pagination/refresh/scroll entry and select an
  enabled built-in fallback. Missing map entries must have safe defaults.
- Home `discovery_config` projection must preserve `sourceUrl` / `sourceKind`,
  rebuild dynamic external channels, apply removals and selection fallback,
  and retain compatible unknown JSON fields. External configurations must not
  enter the AI Custom Discovery scheduler or its IndexedDB store.

## Domain-owned implementation

- `src/services/externalDiscoveryFeed.ts` exports
  `readExternalDiscoveryFeed(url, signal?)`,
  `readExternalDiscoveryRssFeed(url, signal?)`, and
  `loadExternalDiscoveryFeed(url, externalChannelId, api, kind?, signal?)`.
  The API is structural: only `getRepositoryDetails(owner, repo, signal?)` is
  required. Feed requests use direct browser fetch, omit credentials, never
  attach tokens, and reject redirects. Limits: 128000 UTF-8 bytes, 15000 ms,
  30 repository names, at most five concurrent GitHub detail requests.
- Discovery actions and sidebar/view integration remain in domain ownership.
  The add hook guards account changes (including away-and-back), aborts old
  validation, and passes the captured numeric user ID into Store add.
- Locale delta: `docs/personal/upgrades/external-feed-locale-additions.json`.
  Main applies it to locale files; domain code provides English defaults.

## Remaining boundary

Client URL checks cannot attest DNS resolution or prevent DNS rebinding.
This implementation adds no feed proxy and must not reuse the WebDAV proxy.
GitHub detail cancellation ultimately depends on the main-owned GitHub API
honoring its existing signal parameter through transport and body reads.

## Domain implementation handoff

- Added `src/components/AddExternalFeed.tsx` and its test; desktop and mobile
  `DiscoveryChannelMenu` entry points share this dialog. Deletion is exposed
  only for external IDs. Built-in toggles and local Custom Subscription
  creation/navigation remain intact.
- Updated `DiscoverySidebar.tsx`, `DiscoveryView.tsx`, and
  `DiscoveryChannelMenu.tsx` with external add/remove controls, readable names
  and safe missing-map defaults. External errors use the existing retry
  surface, with a page-one refresh rather than pagination.
- `useDiscoveryActions.ts` delegates only its external branch to new
  `useExternalFeedLoading.ts`. External loads do not read or write the Custom
  Discovery database, scheduler, or AI analysis storage. Existing built-in
  loading and explicit repository analysis behavior are unchanged.
- New `useExternalFeed.ts` validates before invoking the central synchronous
  add API, passing the captured numeric account ID. New
  `application/externalFeedRequest.ts` observes synchronous Store transitions
  to cancel account/token changes even when away-and-back is React-batched.
  Loading also cancels source changes, disable, deletion, replacement and
  unmount, guarding both result writes and loading cleanup.
- New `application/discoveryChannelDisplayName.ts` prevents i18next from
  interpreting the colon in an external ID as a translation namespace.
- Completed `src/services/externalFeedConfig.ts` and `externalFeedParsers.ts`,
  keeping `externalDiscoveryFeed.ts`, `externalFeedErrors.ts`, and
  `src/types/externalFeed.ts` as the agreed domain contract. Config
  normalization preserves compatible unknown entry fields.
- Service tests: `externalFeedConfig.test.ts`, `externalFeedParsers.test.ts`,
  `externalDiscoveryFeed.test.ts`. Lifecycle tests:
  `useExternalFeed.test.tsx`, `useExternalFeedLoading.test.tsx`. UI tests:
  `AddExternalFeed.test.tsx`, `DiscoveryChannelMenu.test.tsx`,
  `DiscoverySidebar.externalFeed.test.tsx`.
- Locale merge payload is `external-feed-locale-additions.json`: `namespace`
  is the target namespace and `en` is the namespace subtree to deep-merge.
  Every new translated UI label supplies an English default. No locale file
  was changed by the domain owner.

The domain owner made no edits to types/index.ts, Store, Home, App, githubApi,
packages, the original checkout, or user data; no install or commit was run.
Real-browser CORS and visual smoke checks remain separate from the jsdom
tests, and DNS resolution/rebinding cannot be attested by the client validator.

## Verification (2026-10-02)

- Exact annotated `v0.8.5` commit confirmed with
  `git rev-parse 'v0.8.5^{commit}'`: the authoritative SHA above.
- Final selected Vitest run: 27 files, 303 tests passed. Selection covers all
  external service/hook/UI tests, the full existing Discovery feature tests,
  accountWorkspace, useAppStore and Home discoveryDesktop tests.
- ESLint passed for domain-owned implementation and tests; frontend
  `check-boundaries.cjs` passed; tracked domain changes passed
  `git diff --check`.
- The expanded run that also included Store modularization had 308 passes
  and two failures: `useAppStore.modularization.test.ts` lines 198 and 252
  still assert version 16 rather than the new version 17. Store owner must
  update those expectations.
- Final global `tsc -b --noEmit` reported no errors in the domain external
  files. It still failed on concurrent non-domain changes in
  `MarkdownRenderer.test.tsx`, `useBatchStarHistory.test.tsx`,
  `useBatchStarImport.test.tsx`, `repositoryIdentityMigration.ts`, and
  `releaseFilterLinks.test.ts`. These were not modified by the domain owner.
- Full application build, real-browser visual checks and live-network CORS
  checks were not run. No installation, token-bearing feed request, proxy,
  commit or original-checkout/user-data modification was made.
