# AI UX Incremental Delivery

Date: 2026-09-29

## Implemented

- Repository answers publish draft/reviewing/final events. Only settled answers are saved as completed results.
- Workbench previews survive concurrent history refresh; navigation does not stop the existing workbench task.
- Review quality, claims and requirement coverage persist with messages and render in history.
- Multi-repository synthesis now receives a separate original-request/evidence review within its total deadline. Invalid or failed review retains an explicitly unreviewed draft.
- Markdown export includes answer state, review status, coverage, claims, missing requirements and source versions.
- Desktop local research is available in the existing workbench with follow-up history and source previews. History remains device-only and is excluded from backup.
- Local directory identity is checked when rebinding. Old transcripts without identity remain readable but use a new conversation for a new grant. Account/token changes revoke grants, including A-to-B-to-A picker races.
- Settings automatically attempt program detection, display the full executable path, provide Save and Test / Enable and Activate, and collapse advanced parameters.
- Canceling Save and Test during save does not start a subsequent generation.
- Summary and detail context use section selection, excluding sponsorship noise. Truncated fenced commands are omitted.
- Gist reranking recalls from the full supplied collection before applying its candidate cap. Superseded/account-invalidated searches cannot overwrite newer results.
- Release prompts request upgrade impact, breaking changes and documented migration steps without inventing commands.
- New setting/research/review labels cover all ten existing locales.

## Verification

- Full frontend: 174 files, 1993 tests passed.
- Electron MCP: 33 passed.
- Electron AGY: 36 passed.
- Electron plugins: 103 passed, 1 skipped.
- Version tests: 10 passed; CI gates: 27 passed; desktop launcher: 4 passed.
- Backend: 20 files, 137 tests passed.
- Typecheck, locale parity/key checks, dependency boundaries, production build and bundle budget passed.
- An initial full test run concurrent with the production build timed out in an existing README modal test. The subsequent full run passed.
- Real isolated-profile Electron settings verification passed: detection, 14 models, Chinese structured connection test, enable/activate, synthetic repository summary and restart persistence.
- Settings controls passed ten locales at 390/1280 viewport widths. Screenshots were generated and the Chinese narrow-screen screenshot was inspected.
- Workbench fixture E2E passed at 390/1280 widths with no page errors or page overflow; review status and local reauthorization controls were visible. The narrow-screen screenshot was inspected. This used no model calls.
- First two settings attempts failed at model-list refresh with IO_FAILED, without generation. The next attempt passed; intermittent model-list IO still warrants monitoring.
- Generation ledger: 52 calls before this increment; 2 new calls; 54/60 cumulative. No new private-code evaluation.
- This is not a new 30-task answer-quality benchmark. Existing historical scores are not claimed as acceptance for this increment.

## Remaining Plan Scope

The overall UX plan is not complete. These are not represented as implemented:

- Mixed local/GitHub research in one turn, same-version evidence reuse and automatic stale-evidence detection.
- Structured cross-repository support matrices and one-click continuation of remaining research batches.
- Unified persisted batch-task panel with pause/resume/checkpoints and failure-only retry across every entry point.
- Persistent search coverage/fallback presentation, complete discovery localization/cache presentation, and classification review filters.
- Explicit requirement extraction before every turn, full queue-position/file-count status projection, and measured 300ms/500ms latency acceptance.
- Fresh 30-task recorded/live evaluation, all keyboard/screen-reader flows, and authentication/quota recovery E2E.
- Small presentation follow-ups: local composer still uses the generic GitHub-search placeholder, and claim/source drawers currently share a label.

## Reproduction

PowerShell, repository root:

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npm run test:run
npm test --prefix server
npm run typecheck
npm run check:i18n
npm run check:boundaries
npm run build
```

With Vite on 127.0.0.1:5173 and Playwright available through NODE_PATH:

```powershell
node scripts/verify-ai-ux-workbench.cjs
# Real model calls are budgeted; do not run blindly:
node scripts/verify-agy-settings.cjs
```

Detailed outputs: `output/ai-ux-regression.log`, `output/ai-ux-server-tests.log`,
`output/ai-ux-build.log`, `output/agy-settings/report.json`.
