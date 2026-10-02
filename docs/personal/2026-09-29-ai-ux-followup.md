# AI UX Follow-up Verification

Historical intermediate report. The final results and revised Chinese/English scope are in
`2026-09-29-ai-ux-final-acceptance.md`. Counts and outstanding work below describe the earlier snapshot,
not the current delivery.

## Delivered

- Literal user requirements and explicit language/format precedence in research prompts.
- Mixed local/GitHub research, per-repository progress, same-SHA checkpoints and continuation.
- Supported/unsupported/unknown comparison cells with same-repository source excerpts, persisted and exported.
- Same-version GitHub file cache and local hash-change detection on reread.
- Device-only summary/detail/Gist task journal: pause, stop, manual restart recovery and failed-item retry.
- Header task panel, including keyboard opening, Escape and focus restoration.
- Persistent search mode/range/fallback reporting; vector rerank failure no longer claims keyword fallback.
- Classification conflict filter and batch selection respecting locks.
- Chapter-aware README selection also used in workbench screening and custom discovery.
- AGY queue positions, localized recovery messages, and preserved drafts on failed finalization.
- Account changes during confirmation and A-B-A switches cannot commit stale summary results.

## Verified

| Gate | Result | Evidence |
| --- | --- | --- |
| Frontend | 177 files / 2013 tests passed before final queue/focus presentation changes | output/ai-ux-followup-regression.log |
| Backend | 20 files / 137 passed | output/ai-ux-followup-server.log |
| AGY | 37 passed, including queue-position cancellation | output/ai-ux-followup-agy.log |
| MCP | 33 passed | output/ai-ux-followup-mcp.log |
| Plugins | 103 passed, 1 skipped | output/ai-ux-followup-plugins.log |
| Settings real E2E | Detection, 14 models, Chinese connection test, activation, actual summary, restart persistence | output/agy-settings/report.json |
| Settings layout | 10 locales at 390/1280; no clipped controls | output/agy-settings/report.json |
| Workbench Electron | Local rebinding, comparison, task recovery display, keyboard/focus, 390/1280, no page errors/overflow | output/ai-ux-workbench/report.json |
| Response latency | Hook integration: running under 300ms, draft under 500ms, atomic final replacement | useAIWorkbench.test.ts |
| Error recovery | Auth, quota/rate limit, queue timeout, timeout, permission failure, retry without model switch | AgyConfigPanel.test.tsx |
| Static/build | Typecheck, locale checks, boundaries, production build/bundle passed | output/ai-ux-followup-build.log |

Latency measurements cover application state delivery in the test environment, not a universal device or network SLA.
Error-recovery component tests use a simulated bridge; actual provider-side auth/quota failures were not induced.

## Content Evaluation

- 30 synthetic tasks across long README, negation, formatting, follow-up, multi-repository, local, Gist, Release, classification and missing evidence.
- One real batched CLI request: 28/30 passed the predefined exact-value rubric, meeting 27/30.
- T01 returned a more specific purpose phrase than the expected literal. T17 returned `>=3.11` instead of `3.11`. Original failures remain recorded; no post-hoc score inflation.
- No unsupported installation commands were observed in this sample. Exact quoted evidence does not independently prove semantic support.
- Scope is model content behavior, NOT 30 independently executed end-to-end business workflows.
- Runtime 58.82 seconds; reported usage: 4,859 input, 17,516 output (including 16,004 thinking), 22,375 total tokens.
- Cumulative generation budget is 60/60. Do not run live evaluation scripts again under this budget.
- Reports: output/ai-ux-content-report.json, output/agy-generation-ledger.jsonl, output/agy-generation-usage.jsonl.
- Initial UI-evaluation attempts encountered stale Vite module identities and a canceled request before prompt dispatch. Scripts now resolve the application-loaded store module. These failed attempts are not counted as passing workflow tests.

## Still Not Fully Accepted

- Complete ten-language custom-discovery UI conversion and cache freshness presentation.
- Discovery/plugin tasks are not yet part of the summary/detail/Gist journal.
- Old evidence is checked when reread; no proactive whole-history stale-evidence scan or local content cache.
- Full screen-reader testing, every keyboard path, and actual provider auth/quota recovery E2E.
- Fresh independent end-to-end evaluation for all 30 content tasks. Additional live testing requires a new explicit budget.

## Reproduce Without Model Calls

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run --maxWorkers=4
npm test --prefix server
npm run test:electron:agy
npm run test:electron:mcp
npm run test:electron:plugins
node --test scripts/ai-ux-content.test.cjs
npm run typecheck
npm run check:i18n
npm run check:boundaries
npm run build
# With Vite on 127.0.0.1:5173 and Playwright in NODE_PATH:
node scripts/verify-ai-ux-workbench.cjs
```
