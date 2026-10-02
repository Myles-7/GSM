# GSM AI UX Final Acceptance

Date: 2026-09-29. This report supersedes the outstanding lists in the delivery and follow-up reports.
The user narrowed UI acceptance to Chinese and English. Existing other-language resources remain intact.
No subagents were used for this increment.

## Delivered In This Increment

- Open conversation evidence now checks current GitHub SHA or authorized local file hashes. Historical snapshots are not rewritten. Unknown, changed and rebind-required states are visible.
- Discovery, discovery enrichment and plugin operations join the existing device-only task journal. Discovery supports stop, enrichment supports pause/resume/stop, and failed enrichment can be retried from the original channel.
- Completed discovery channels remain completed if a later channel fails. Early cancellation does not dispatch work. Missing retry targets show an actionable message.
- Task panel distinguishes failed and partially completed work instead of labelling every settled batch successful. Plugin work opens the existing plugin settings/confirmation flow rather than silently replaying actions.
- Discovery displays generation, analysis and README cache times; known repository version changes are indicated.
- AGY login, rate-limit, queue/startup/generation timeout errors map to actionable Chinese/English recovery guidance.
- Small, complete single-document local projects read the complete document without redundant retrieval-planning calls.
- Multi-repository intermediate turns collect evidence without generating and reviewing separate final answers. Overall synthesis and review keep 40% of the total budget; pure collection does not reserve answer time again.
- A review that ignores cancellation settles before the outer deadline and retains the completed answer as unreviewed. Review status is not put in the missing-user-requirements list.
- Real evaluation scripts resolve loaded Vite modules, use bounded report filenames, record every generation and distinguish batched content tests from independent calls.

## Coverage Matrix

| Area | Acceptance evidence | Result |
| --- | --- | --- |
| Summary, platforms, classification | Independent real business service calls | 5/5 |
| Gist analysis | Independent real business service calls | 2/2 |
| Release impact/negation | Independent real business service calls | 2/2 |
| Repository/Gist reranking | Independent real business service calls | 2/2 |
| Query expansion/constraints | Independent real business service calls | 2/2 |
| Chinese/English requirements | Independent real business service calls | 2/2 |
| Article, exact JSON, insufficient evidence | Independent real business service calls | 3/3 |
| Authorized local research | Real Electron bridge and synthetic local file; hash, claims and coverage validated | 1/1 |
| Multi-repository comparison | Synthetic GitHub transport, real model; both sources, claims and matrix | 1/1 |
| Settings and restart | Real detection, 14 models, save/test/enable, summary and persisted settings | Passed |
| Settings recovery | Injected auth/rate-limit/timeout/permission errors through real desktop service, followed by real successful connection | Passed |
| Workbench history/tasks | Isolated Electron fixture; local rebind, partial task, failure retry, matrix, keyboard/focus | Passed |
| Layout | Chinese/English, 390 and 1280 widths; no page/control overflow; screenshots inspected | Passed |
| Lifecycle and late results | Frontend and Electron cancellation/account/queue/checkpoint regressions | Passed |

Business result: **20/20** tasks, comprising 18 text workflows plus local and multi-repository research.
These are separate real service-level business calls in Electron, not a claim that every workflow was driven entirely by UI clicks.

Local research completed in 87.7 seconds with 17 supported claim entries and 7 requirement-coverage entries.
Multi-repository comparison completed in 119.4 seconds with 8 claim entries, 5 coverage entries and 2 comparison cells.
Both returned `quality=model-reviewed` and no missing requirements. This is model review, not independent factual proof.

## Independent Content Evaluation

- Thirty separate real model requests, synthetic/public-style evidence only.
- **27/30** passed the unchanged exact-value rubric, meeting the specified 27/30 threshold.
- T01 used a more specific purpose phrase rather than the literal `Markdown editor`.
- T07 returned the correct JSON facts as an object in `answer` instead of the required JSON-encoded string.
- T17 returned `>=3.11` rather than the literal minimum version `3.11`.
- All three remain recorded as failures. No post-hoc normalization or score inflation was applied.
- No unsupported key installation commands were found in these samples. This does not guarantee future answers.
- Runtime: 720.85 seconds; reported total usage: 165,784 tokens.
- The previous one-batch 28/30 result remains a separate historical report.

The independent content harness calls the CLI directly; application workflow behavior is covered by the separate business tests above.

## Regression Results

| Gate | Result |
| --- | --- |
| Frontend | 181 files, 2,034 tests passed |
| Backend | 20 files, 137 tests passed |
| Electron AGY | 37 passed |
| Electron MCP | 33 passed |
| Electron plugins | 103 passed, 1 skipped |
| Version / CI / launcher | 10 / 27 / 4 passed |
| Content scorer | 2 passed |
| Typecheck, i18n, boundaries | Passed |
| Production build and bundle budget | Passed |

The last changes after the full frontend run were Chinese/English error copy; they subsequently passed typecheck, locale checks, production build and real settings E2E.

## Budget And Failed Attempts

- Authorized cumulative ceiling: 170 (original 60, then 10, then 100).
- Actual cumulative prompts sent: **128**. Remaining: **42**. No additional generation is scheduled.
- Initial high-effort local research exhausted its 180-second total deadline; multi-repository research then hit the previous 70-call ceiling. These exposed the redundant generation/review and deadline-settlement issues fixed above.
- A later text-workflow run hit a Windows report-filename-length error after generation. The script now uses a bounded filename; the successful rerun is the reported 18/18.
- One preflight failed because Vite was not running and did not send a prompt.
- Failed/aborted generations are counted, not removed from the ledger.

## Known Boundaries

- UI acceptance is Chinese/English and Windows desktop. Other operating systems and other-language discovery UI are not certified.
- Actual provider credentials were not invalidated and quota was not intentionally exhausted. Recovery faults were injected, then followed by a real successful call.
- Keyboard/focus/live-region behavior was checked; a human NVDA/JAWS session and every possible assistive-technology combination were not tested.
- Historical freshness checks run when a conversation is opened or updated, not as a whole-library background crawler. Local files must be rebound after restart.
- Plugin APIs without cancellation cannot be made cancellable by the task panel. No unsupported control is displayed; late account-invalidated results are rejected.
- Exact machine-readable transport can still fail, as T07 demonstrates. Application structured writes retain validation and are not accepted solely because a model produced text.
- High effort can remain slow on larger projects. Models and effort are never silently changed. Pending research can be continued explicitly.

## Evidence And Reproduction

- `output/agy-business-retest-text-workflows.json`
- `output/agy-business-retest-local-research,multi-repository.json`
- `output/ai-ux-content-independent.json`
- `output/agy-settings/report.json`
- `output/ai-ux-workbench/report.json`
- `output/agy-generation-ledger.jsonl` and `output/agy-generation-usage.jsonl`
- `output/ai-ux-final-*.log`

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run --maxWorkers=4
npm test --prefix server
npm run test:electron:agy
npm run test:electron:mcp
npm run test:electron:plugins
npm run test:update-version
npm run test:ci-gates
npm run test:desktop-launcher
node --test scripts/ai-ux-content.test.cjs
npm run typecheck
npm run check:i18n
npm run check:boundaries
npm run build

# With Vite on 127.0.0.1:5173 and Playwright available through NODE_PATH:
node scripts/verify-ai-ux-workbench.cjs # No model calls.
# The following consume the remaining authorized budget; do not run blindly:
node scripts/verify-agy-settings.cjs
node scripts/evaluate-agy-business.cjs --only=local-research,multi-repository
node scripts/evaluate-ai-ux-content.cjs --independent
```
