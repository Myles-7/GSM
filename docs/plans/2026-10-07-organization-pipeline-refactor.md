# AI organization pipeline refactor

## Scope and recovery

- Local branch: `codex/organization-depth-concurrency-20261006`; no agents, push, installer, Star, Lists, or automatic classification application.
- Recovery root: `D:/GSM-backups/organization-pipeline-20261006`. Contains exited desktop profile, old dist, tracked patch/untracked source snapshot, online SQLite backup (`integrity_check=ok`) and separately protected encryption key. None is in Git.
- Original shortcut, Electron userData, file origin and Store persistence version 17 remain unchanged. Port 5174 is untouched; isolated development preview is 5198.

## Evidence, not assumptions

- Latest saved task `875412fd-f2a8-4ffb-9c6c-720c0f50ca0b` was interrupted in assignments with `AGY_IO_FAILED`. It retained 368 understood / 1 insufficient facts, 35 summaries, and both completed taxonomies. The error list was empty.
- The insufficient repository was already assessed, not pending. It does not explain this I/O interruption.
- Old bridge diagnostics discarded the original operation/errno. Temporary workspace cleanup is a tested failure path, not a proven historical root cause.
- Earlier tasks contain other causes (timeouts/pending understanding); these must not be collapsed into the latest cause or a generic unavailable-model message.

## Implementation

- Split execution, structure planning and paired assignments into scoped modules. Quick mode prepares metadata/current cache/dated analysis locally, designs from full compact inventory, and combines necessary facts plus both memberships in each batch (at most ten repositories). Deep mode retains README/document verification using the same executor.
- Compact inventory is summarized only above the input threshold, with one level. Failed chunks keep their complete compact records as fallback; excessive unresolved input causes an explicit scheme failure, never silent domain loss.
- Executor binds account/scope/config/prompt identities, retains cumulative request history, budgets retries/format repair/splits, preserves accepted rows, and isolates batch errors. Fatal account/auth/config/safety/process-exit failures interrupt the task.
- Taxonomies completed before upgrade survive explicit continuation. Legacy assignments without completion markers are conservatively verified again; manual targets survive. No startup request or application replay.
- AGY global pool owns execution slots and rate-limit cooldown; task workers only bound dispatch. Repeated timeouts conservatively reduce capacity. Executable verification is cached per task with file-identity rechecking. Each request still has an isolated workspace.
- Missing process close/termination is bounded and quarantines the pool instead of recycling an uncertain slot. Cleanup I/O failure no longer destroys successful output. Safe operation/errno are returned without filesystem paths.
- Separate, throttled request traces show actual model/effort, phase, batch, queue/init/generation/cleanup times, attempts, output arrival, codes and validation. AGY public response deltas are visible; reasoning/tool events are never exposed or executed. Non-streaming HTTP providers show returned artifacts, not fabricated streaming.
- Public preview is capped at 32 KiB/request; persisted failure excerpts at 16 KiB, seven days and 10 MiB/account. Inputs and credentials are not saved as diagnostics. Existing chat storage holds optional execution/checkpoint fields; derived diagnostics do not create another chat database.
- Generation now shares the category tree and compact repository list. Independent preparation, structure and verified membership counts replace the misleading single understanding progress bar. Failed request details are visible without an additional popup; assignment batches can be retried alone.

## Focused checks

- Typecheck, scoped ESLint and locale parity passed before final display polish; rechecked at final delivery.
- 32 pipeline/reliability/modal tests plus 26 executor/diagnostic/transaction/refinement tests passed. Coverage includes 369 repositories, paired partial validity, actual I/O mapping, retained request history, single-batch retry, input omission/duplicates, bounded budgets, cancel/late response, ownership, manual protection and existing transaction/recovery behavior.
- 32 AGY runtime/desktop/queue tests passed, including cleanup failure after valid output, missing close, and quarantined slots.
- Fictional Electron workflow and desktop/narrow screenshots passed: no page errors or horizontal page overflow. One uncertain item triggered one shared README fetch; no real account write.
- Production file-origin smoke on a profile copy passed: 369 repositories, 366 summaries, purpose/technology schemes, unchanged persistence version, zero model calls or classification applications.
- Production build and bundle budget passed. Existing translate.js eval and mixed dynamic/static import warnings remain; CSP was not weakened.

## Real model gate

Sample is restricted to ten real repositories; all model/probe/retry calls have a durable main-process ceiling of twenty. Tests run with a copied profile and fictitious account, only producing drafts.

The selected `gemini-3.8-flash-high` rejected medium effort (`MODEL_EFFORT_CONFLICT`), so the original high setting is retained. An initial high-effort planning request timed out at 180 seconds without public output. Some initial measurements overlapped a resource-heavy production build, so they are not a clean throughput benchmark and cannot establish a model-only root cause or speedup factor.

Final sample used five model requests: one incompatible medium probe, one high planning timeout (180.7s), two successful high planning responses (176.1s / 54.1s), and one assignment request canceled at the 480s sample deadline. First public output for the two successful responses arrived at 171.4s / 51.3s. No second concurrency benchmark or full-library continuation was run after this failure. The sample gate did not pass; no speedup factor or full-library quality is claimed. Ledgers and redacted results remain in the recovery directory, outside Git.

Full regression and real application/sync/recovery acceptance are not claimed in this round. Desktop restart verification is recorded below after completion.

## Rollback

Exit the desktop before restoring matching old dist/code and profile/DB/key copies. Restoring only code after data-format writes is insufficient. Classification proposals remain unapplied unless the user explicitly confirms them.

## Desktop delivery

- Final production dist rebuilt, bundle budget passed; same file-origin isolated smoke again passed with 369 repositories / 366 summaries and no page errors, model execution or classification application.
- Original `D:/桌面/GitHub Stars Manager.lnk` launched the updated `electron/main.js` (main PID 43964); original Electron profile is retained. Startup log: `logs/desktop-radC1B10.tmp.log`.
- Final focused gate: 58 frontend/service tests + 32 AGY tests, scoped Lint, locale parity and typecheck passed. A non-failing React act warning remains in one async diagnostic-loading UI test. Existing unrelated SearchBar whitespace caused the broad diff check to fail; scoped changed bridge/schema/type files passed and unrelated edits were preserved.
- Desktop/narrow screenshots were inspected. Narrow request details fold so the repository list remains usable; generation has no premature red empty-structure warning or negative elapsed time. Output shown in the screenshots is explicitly a network fixture, not real model quality evidence.
- Preview remains `http://127.0.0.1:5198`; 5174 was not stopped. No model process from the isolated sample remains running, no full-library task was resumed, and no classification/Star operation was applied by this work.
