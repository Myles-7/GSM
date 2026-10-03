# AI Workbench Overview Delivery

Date: 2026-10-02 (Asia/Shanghai)

## Delivered Behavior

- Conversation and project overview are separate views. The overview occupies the main workspace rather than a fixed 320px sidebar.
- A docked conversation uses 40% of the desktop workspace by default. Project results use 60%; pointer and keyboard resizing are supported.
- History visibility, docking and split ratio are local preferences. Narrow windows show one view at a time.
- Compact project cards group results by purpose and distinguish tools, libraries and resource collections. Detailed relevance, limitations and sources live in a drawer.
- Users can search, filter, sort, select a category or filtered set, add selected projects to context, research selected projects, copy or export the displayed or selected list.
- Overview requests process all returned projects in batches of at most eight. README sections are fetched only when existing material is insufficient. Ready items are reused; failed items can be retried separately.
- Pagination merges into the same result set without losing existing introductions. The conversation also offers a deduplicated all-results view. Changed source descriptions invalidate reused introductions.
- Result questions use existing overview material; fresh search has a separate input intent. Requirements preparation includes recent conversation and preserves answered conditions.
- Draft input survives navigation and failures. Late task completion does not clear another conversation's draft.
- Deep research, evidence, answer review and cancellation retain their existing workflow. Overview categories never update the repository library's formal categories.
- Storage import validation accepts the new optional overview fields and still reads old sessions.

## Verification

Focused regression: 11 Vitest files, 194 tests passed, including existing research, operations, checkpoint, storage and provider tests.

Final verification after the last layout-persistence changes: `npm run typecheck` passed; the two focused workbench/overview files passed all 20 tests; `npx vite build` passed. The bundle-size guard passed at 1792.66 KiB against the existing 3000 KiB limit. Scoped `git diff --check` reported no whitespace errors (only line-ending conversion warnings).

Offline Electron verification:

- Chinese and English, light and dark, at 390/1280/1536/1920 CSS pixels.
- Sixteen screenshots inspected; page and card overflow checks passed.
- Three-project bulk selection, details drawer and keyboard closing, split resizing and docking passed.
- Layout persisted through reload and Electron restart.
- A 120-project result set rendered and filtered successfully.
- No renderer page errors were recorded. Model calls: zero.

Artifacts: `output/workbench-overview/report.json` and its PNG screenshots.

Real AGY verification through production renderer, preload IPC and desktop generation service:

| Call | Scenario | Result |
| --- | --- | --- |
| 167 | Chinese overview of eight synthetic projects | Valid structured output for all eight; library/resource distinction and insufficient-material status passed |
| 168 | English overview of the same eight projects | Valid structured output for all eight; type and missing-material checks passed |
| 169 | Chinese follow-up about two projects and cloud-sync support | Preserved the negative condition; no invented installation command |
| 170 | Requirements with previously answered language/platform/depth conditions | No repeated clarification; usable GitHub queries returned |

CLI durations were approximately 32.5s, 22.7s, 15.0s and 18.5s respectively. These are small synthetic checks, not a large-project or sustained-load evaluation.

Real evaluation allowance is exhausted at 170/170. This ceiling belongs to the evaluation scripts; it does not disable normal application use.

Artifacts: `output/workbench-overview-real.json`, `output/workbench-requirements-real.json`, and the existing generation/usage ledgers.

## Reproduction

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run src/features/ai-workbench src/services/aiWorkbenchService.test.ts src/services/aiWorkbenchOperations.test.ts src/services/workbenchOverview.test.ts src/services/repositoryChatWorkbenchStorage.test.ts src/services/workbenchResearchCheckpoint.test.ts src/services/conversationMarkdown.test.ts src/services/agyClient.test.ts src/services/agyProfiles.test.ts
npm run typecheck
npx vite build
npm run check:bundle-size

$env:NODE_PATH='C:\Users\Li Cheng Xin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node scripts/verify-workbench-overview-ui.cjs
```

Do not rerun real verification with the exhausted allowance. Its scripts enforce the existing ceiling and guard against repeating the completed run.

## Boundaries

- Quick overviews reflect supplied descriptions and selected README sections; they are not deep compatibility or code-quality assessments.
- A single overview follow-up supports up to 120 projects. Larger conversation-wide sets must be narrowed explicitly rather than silently truncated.
- Independent batches may introduce closely related category names. Users can filter them; a global category-normalization pass is not part of this delivery.
- Multiple simultaneous workbench conversations remain outside this scope. Generation concurrency continues to use the existing AGY pool.
- Local research history retains its existing device-only behavior.
