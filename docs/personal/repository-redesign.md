# Repository redesign implementation record

Date: 2026-09-28

## Recovery and isolation

- Starting snapshot: `b857f31` (includes the existing, unfinished AI workbench).
- Recovery tag: `recovery/pre-repository-redesign-20260928`.
- Implementation branch: `codex/repository-redesign`.
- Original checkout and desktop shortcut remain at `D:/桌面/GSM`.
- Backups outside Git: `D:/GSM-backups/repository-redesign-20260928`.
- Desktop exited before copying its Electron profile.
- SQLite online backup includes committed WAL content; integrity check returned
  `ok`, with 65 repository records and 3 category-locked records.
- Encryption key and complete Git bundle are backed up separately.
- No real-account Star/unstar requests, installer builds, or remote pushes.

## Accepted behavior

- Each repository has one stable main-category ID and at most one child ID.
- Existing locked membership is preserved when resolvable. Unique legacy
  matches migrate directly; ambiguous/invalid matches remain pending with
  suggestions. Repeated migration must not overwrite a user's decisions.
- AI and tag changes suggest membership; they do not move assigned repositories.
- Named main-category views contain unframed sections and an outline. All,
  global search, and similar results remain flat.
- Manual order is independent of rule-based sorting. Filtered lists cannot
  rewrite within-group order; explicit cross-group moves remain available.
- Detail analysis is opt-in, evidence-backed, and separate from personal
  descriptions. Old successful results survive failed replacements.
- Persisted data, backend sync, local export, and WebDAV import must round-trip.

## Verification status

- Frontend: 148 files, 1619 tests passed.
- Backend: 20 files, 128 tests passed.
- Electron MCP: 32 passed; plugins: 103 passed, 1 expected platform skip.
- Version checks: 10 passed; CI gates: 27 passed; desktop launcher: 4 passed.
- TypeScript, ESLint, architecture boundaries, i18n and plugin registry passed.
- Frontend/backend builds and bundle-size budget passed.
- Isolated Electron smoke passed at 1600x1000 and 390x844: group creation,
  cross-group moves, rule-sort order preservation, pending confirmation,
  overlay/pinned details and opt-in AI analysis. No page errors or horizontal
  viewport overflow. Screenshots are in the external backup directory.
- A copied desktop profile retained all 65 repositories, personal metadata,
  AI settings, categories and translation preferences. Normalization is
  idempotent: 18 repositories assigned, 47 conservatively pending.
- Copied SQLite migration passed twice with integrity intact.
- Review fixes cover partial backend fetches, missing undo destinations,
  legacy locks, category-ID collisions and undo after category renaming.

## Delivery and limits

- Delivery branch in the original checkout: `codex/repository-redesign-dev`.
- Existing desktop shortcut and `http://127.0.0.1:5174` remain unchanged.
- Network-dependent AI behavior was tested with fixtures, not live providers.
- No live WebDAV roundtrip or real-account Star/unstar was performed.
- New locale keys have English fallback outside Chinese; locale parity passes.
- Browser records, profiles, databases and keys remain outside Git.

## Rollback

Keep the running desktop closed before restoring data. Restore the code recovery
point together with the saved Electron profile, SQLite snapshot, and encryption
key if any real data has been migrated. Do not overwrite subsequent user data
without first backing it up. A code-only rollback is not a data rollback.
