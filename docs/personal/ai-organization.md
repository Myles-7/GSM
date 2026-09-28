# AI repository organization

## Baseline and recovery

- Branch: `codex/ai-repository-organization`.
- Pre-feature checkpoint: `827cb50`, tag `recovery/pre-ai-organization-20260928`.
- Existing repository UI, unified AI analysis, desktop launcher and workbench changes are preserved in this checkpoint.
- Development origin remains `http://127.0.0.1:5174`. No installer or remote push is part of this change.

## Behavior

Repository organization is a separate action from repository analysis. It reuses existing metadata and analysis, proposes a classification structure, and then assigns repositories in bounded batches. The user can refine the draft before explicitly applying selected changes. No GitHub Star/unstar action is performed.

Default scope prioritizes selected repositories, otherwise ungrouped repositories in a named main category, otherwise pending repositories. Every scope respects the current filtered input. Existing assignments are not silently rewritten by background analysis.

The repository panel and AI workbench use the existing conversation/proposal storage and shared task runtime. Drafts, category definitions and assignment snapshots are account-scoped. Older versions remain readable and only the latest version is actionable.

Safety gates include stable identity validation, complete batch coverage, category parent validation, latest-version checks, membership and lock conflict checks, explicit locked-category override, atomic category/assignment updates, and conditional restore. Backend synchronization failure is separate from successful local changes.

## Verification

- Frontend regression: 152 files / 1,653 tests passed, including 29 added tests for scope, generation, execution, backup compatibility and shared conversation lifecycle.
- Backend regression: 128 tests passed. Electron MCP: 32 passed; plugins: 103 passed, one existing platform-dependent skip.
- TypeScript, ESLint, i18n parity, frontend boundaries and plugin registry checks passed.
- Frontend and backend production builds passed. Frontend legacy entry: 1,331.24 KiB against the 3,000 KiB budget. The existing translate.js eval warning remains; this feature does not change CSP or introduce eval.
- Isolated Electron UI: generation, preview, deselection, apply, restore and continuation in the same workbench conversation passed at 1600 x 1000 and 390 x 844, without page errors or horizontal viewport overflow.
- Screenshots: `D:/GSM-backups/repository-redesign-20260928/organization-1790591024123/` (`setup-desktop.png`, `preview-desktop.png`, `preview-mobile.png`, `categories-mobile.png`, `applied-desktop.png`, `workbench.png`).
- Screenshot review moved involved/new categories ahead of unrelated empty categories and replaced always-visible rename inputs with explicit pencil actions.
- Development server remains on port 5174. No real-account Star/unstar requests, installation packages or remote pushes were performed.
- CI gate tests: 27 passed; desktop development launcher: four passed; version tooling: 10 passed.

Automated runs use synthetic accounts, mocked providers and isolated browser profiles. Live provider quality, provider-specific context limits and large-library performance have not been benchmarked. Real WebDAV/server connectivity was not exercised by the isolated UI run; synchronization failure handling is unit-tested.

## Compatibility and recovery

The existing conversation database stores an optional `organization` extension on proposals. No separate database or main Store persistence-version bump was introduced. Old proposals remain compatible; imported organization proposals are read-only history, not queued write operations.

Interrupted generation becomes resumable. Interrupted application/restoration is reconciled against current membership without replaying a write. Draft confirmation binds its persisted update timestamp and latest revision, then checks account, membership, lock state and category identities again before the atomic Store update.

The pre-feature tag restores code only. If the user has applied organization changes, use the operation's restore action before reverting code, or restore a matching application-data backup together with its encryption key. Do not roll code back alone after changing user data.
