# Settings / Vector #421 Integration

This is the domain handoff history. The central identity panel and final
cross-domain wiring were completed separately. Release status, integrated
checks and source commits are recorded in
[P0.2.0 validation](P0.2.0-validation.md) and the migration ledger.

Reference: fixed `git show v0.8.5:<path>`, selectively adapted. No full merge,
dependency changes, commits, real credentials, repository-data migration or
remote indexing performed by this work.

## Main Wiring

- `SettingsPanel` imports `AppearancePanel` directly. No settings barrel export
  is required. The `appearance` tab participates in the existing sessionStorage
  and `gsm:navigate-to-settings-tab` navigation contracts.
- CategorySidebar adds Vector Search and Electron-only Plugin Management
  shortcuts without altering category assignment, locking or pending categories.
  Each shortcut writes `gsm:pending-settings-tab` before `setCurrentView('settings')`.
  No App props or wiring changes are required.
- Home, HTML Reading, AI/AGY, backend/network/MCP visibility, current theme
  presets/tokens, language choices and card field actions are retained. No
  retired `translationEngine` / `autoTranslateRepoDescription` fields are added.
- Card-field checkmarks require only a small presentation addition to the
  existing ThemeSettingsCard; its settings and actions remain unchanged.
- General reuses the batch/auth worker's actual export:
  `import { GitHubTokenPermissions as TokenPermissionsGuide } from '../GitHubTokenPermissions'`.
  The module currently exports `GitHubTokenPermissions`, not
  `TokenPermissionsGuide`; the local alias avoids requiring another worker to
  change that contract. No settings barrel or package edits are needed.
- General directly imports and mounts the now-available main-owned
  `RepositoryIdentityMigrationPanel` after the Token guide, in its own section,
  separate from Token and vector operations. It takes no props and owns dry-run
  and confirmed resume; this worker does not implement or execute migration.
- Main should merge `settings-locale-additions.json` into the `app` namespace.
  New UI keys have English `defaultValue` fallbacks until that merge; existing
  locale files are not edited here. The existing `settingsPanel.plugins` value
  is included for other callers, while new navigation uses `plugin-management`.
  Other supported locales need corresponding additions/fallback review.

## Local Pending API

`countLocalVectorPending(repositories, activeEmbedding, vectorSearchConfig)`
is a synchronous, read-only utility. `formatLocalVectorPending(count)` caps only
presentation at `99+`. `useLocalVectorPendingCount()` subscribes to the minimum
store slice and does not instantiate action/service state.

`useVectorSearchActions()` adds `unindexedRepoCount` for upstream-compatible
callers. It is independent of `incrementalTargetCount`, which remains the full
compatible-generation candidate scan. Zero local pending does not disable a
candidate scan: README or content changes not visible in local stamps can still
require writes.

Only analyzed, non-failed repositories count. Disabled vector search returns
zero. Missing/incompatible embedding/index identity or generation requires a
rebuild; eligible repositories then count as locally pending. For a compatible
generation, missing or mismatched identity/namespace, missing/invalid content-hash
stamp, or the engine's existing `needsReindex(repo, false)` metadata predicate
counts once. That predicate handles last edit, analysis, push/update timestamps
and normalized license changes.

An active generation carries the authoritative format identity. A stale global
`embeddingFormatVersion` alone is not grounds to reindex an otherwise compatible
generation. Credential changes alone do not change its semantic identity.

The badge is local evidence, not an exact future write count or Worker status.
It does not fetch README, request AI/embedding/Worker services, calculate actual
content hashes or synthesize new persisted stamps. Only user-triggered indexing
invokes the unchanged hash/readme/embedding/upload pipeline. Old generations
and stamps are still retained until the existing verification barrier permits
publication; failures/cancellation never publish a new generation.

## Persistence Boundary

Read existing hook, engine, identity, store config normalization, persistence
partialization and repository metadata merge before adding the counter.
Repository/index identity stamps already exist and are persisted locally, so
no Store/types/schema migration is required for the badge.

At inspection time `repositoryMerge.ts` preserved indexed time, license,
identity and generation but did not list `vector_indexed_content_hash` among
locally preserved fields. Main/vector-storage ownership should review that
round-trip separately: missing hashes conservatively count as pending, but
badge code must not repair/recreate them. ID rekeying must invalidate or migrate
vector stamps through the existing identity participants, not through settings.

## Verification

Final scoped run: 13 test files / 177 tests passed. The run includes
`localVectorPending`, `useVectorSearchActions`, `SettingsPanel`,
`CategorySidebar.settings`, `AppearancePanel`, `GeneralPanel.desktop`,
`ThemeSettingsCard`, `VectorIndexOperationsPanel`, `VectorSearchSettings`,
`vectorIndexGeneration`, `vectorSearchService`, `HtmlReadingPanel` and
`AgyConfigPanel`. ESLint passed on all 20 owned TypeScript/TSX files.
The General test fixes the store language to Chinese and derives the guide
button/tab accessible names from the app/login translation keys; it does not
remove or override the merged localization.

Vite production build passed with existing eval/dynamic-import warnings.
Whole-project `tsc -p tsconfig.app.json --noEmit --incremental false` failed
only on two references to the nonexistent `VectorSearchConfig.activeGeneration`
in main-owned `src/services/repositoryIdentityMigration.ts:78` at this run.
That central identity file was not edited by the settings worker.

Scoped tests cover local count, identity/generation/format changes, disabled
state, no-request/no-hash counting, candidate independence, publication
barriers, Appearance language and card controls, General desktop/token guide,
settings mobile/modal navigation, CategorySidebar mobile/expanded/collapsed
shortcuts, independent vector operations, progress/abort/failure and unsaved
draft guards.

Whole-project type checking is separate from these scoped tests. Concurrent
workers may leave unrelated in-progress errors; report those rather than
modifying their files. No paid/live indexing is part of verification.

Synthetic browser QA uses `output/settings-qa/index.html` on
`http://127.0.0.1:5271/output/settings-qa/index.html?tab=appearance`.
The preview disables persistence and live fetches, uses no real account and
seeds synthetic repositories only after initial hydration. Appearance layouts
were inspected at 320, 768, 1024 and 1440px; Vector layouts at 320 and 1440px.
Screenshot artifacts live in that output directory. The temporary browser
viewport was reset after inspection. The existing mobile tab indicator is
clipped to its container and vector test/save/command rows wrap instead of
overflowing at narrow widths.

## Owned Files

Modified:
- `src/components/SettingsPanel.tsx`
- `src/components/CategorySidebar.tsx`
- `src/components/settings/GeneralPanel.tsx`
- `src/components/settings/GeneralPanel.desktop.test.tsx`
- `src/components/settings/ThemeSettingsCard.tsx`
- `src/components/settings/ThemeSettingsCard.test.tsx`
- `src/components/settings/VectorSearchSettings.tsx`
- `src/features/settings/hooks/useVectorSearchActions.ts`
- `src/features/settings/hooks/useVectorSearchActions.test.tsx`

Added:
- `src/components/SettingsPanel.test.tsx`
- `src/components/CategorySidebar.settings.test.tsx`
- `src/components/settings/AppearancePanel.tsx`
- `src/components/settings/AppearancePanel.test.tsx`
- `src/components/settings/VectorIndexOperationsPanel.tsx`
- `src/components/settings/VectorIndexOperationsPanel.test.tsx`
- `src/components/settings/VectorPendingBadge.tsx`
- `src/components/settings/VectorSearchSettings.test.tsx`
- `src/features/settings/hooks/useLocalVectorPendingCount.ts`
- `src/utils/localVectorPending.ts`
- `src/utils/localVectorPending.test.ts`
- `docs/personal/upgrades/settings-integration.md`
- `docs/personal/upgrades/settings-locale-additions.json`

The migration panel, shared Token guide, central identity services, App, Store,
types, vector storage, locale files and package files belong to other workers
and are not included in this ownership list.
