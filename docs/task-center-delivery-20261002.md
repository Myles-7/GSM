# GSM Unified Task Center Delivery

Date: 2026-10-02. Scope: device task journal, unified presentation, existing executor adapters, English/Chinese UI. No new model scheduler or primary navigation tab.

中文交付摘要：任务中心界面、记录持久化和既有执行器接入已完成本轮开发及离线回归。任务按钮始终可见，可进入快速抽屉和完整页面；支持筛选、详情、能力对应的控制、失败项重试、历史管理和报告导出。不能断点恢复的任务明确返回来源操作，不宣称全部任务可恢复。打包版 Electron 交互验收和新的真实模型调用未执行；当前真实调用账本已达到 170/170。

## Delivered

- Always-visible header entry, separate active-count and attention indicators, scrolling quick drawer and full task view.
- Two-column desktop cards, one-column list alongside details, narrow-screen detail view with list-scroll restoration.
- Status/type/trigger/name filters, stable creation-time ordering, archived/background history, incremental display of large item lists.
- Truthful pause/resume/stop controls, failed-item retry and unfinished-item continuation for supported batch executors. Batch failed retries are submitted sequentially to existing executors; AGY internal concurrency remains unchanged.
- Retry lineage, original configuration snapshots, per-retry model/AGY effort/timeout overrides, explicit replacement when the original configuration is unavailable.
- Real item errors, phase/count/elapsed presentation, source/result navigation, Markdown/JSON report export, terminal-history archive/restore/delete.
- IndexedDB journal with legacy migration, no 20-record truncation, coalesced progress writes and immediate terminal/checkpoint persistence. IndexedDB wins stale legacy duplicates; legacy data is retained if migration fails.
- Device unfinished records become interrupted after restart without automatic execution. Server records retain original IDs and are polled; stale connection receipts and uncertain submissions remain explicit.
- Invalid pending-submission metadata cannot block ordinary server polling. Explicit recovery calls the existing original-request recovery flow; polling does not replay generation.
- Release results persist locally with source-version checks, can finish after page navigation when the global task host is mounted, reject late results after account changes, and clear canceled loading states. Persistence failure produces a partial task rather than silent success.
- Task reports exclude raw request/response data and device target paths. Conversation-derived titles/item labels are replaced with generic business names. Errors retain the existing credential/path redaction.

## Control Capability Matrix

All rows are visible in the center. "Source" means use the original feature's operation, not a centrally advertised checkpoint guarantee.

| Task | Pause / Continue While Running | Stop | Retry / Restart Recovery | Result Location |
| --- | --- | --- | --- | --- |
| Repository summaries | Yes; finish current children first | Yes | Failed/unfinished children centrally; linked new record | Repository detail |
| Repository details | Yes; finish current children first | Yes | Failed/unfinished children centrally | Repository detail |
| Batch Gist summaries | Yes; finish current batch first | Yes | Failed/unfinished children centrally | Gist detail |
| Single Gist summary | No | Yes | Central failed-item retry, source action | Gist detail |
| Custom subscription retrieval | No | Yes | Failed/unfinished channels centrally | Subscription channel |
| Subscription project analysis | Yes; finish current children first | Yes | Failed/unfinished projects centrally | Channel/source project |
| Repository chat | No | Yes | Source retries original round; no extra user-message append | Original chat session |
| Workbench GitHub/local/mixed research | No | Yes | Source checkpoint/continuation flow; local access requires authorization | Workbench session |
| Classification/organization | No | Existing workbench stop | Source draft/recovery flow | Workbench draft |
| Repository/Gist AI search | No | Yes for signal-bound search | Source rerun; not checkpoint resume | Search source |
| Release summary | No | Yes | Source retry; persisted completed result | Release timeline |
| Plugin page AI | No | Yes | Source operation and existing confirmation | Plugin settings/page |
| Plugin Worker action/processor/export | No | No cancellation contract | Source; no automatic replay | Plugin source |
| Vector index build | No | Yes until generation publication | Source rebuild; old generation retained | Vector settings |
| Batch Star import | No | Yes for remaining items | Source reviews completion before retry | Repository import |
| Star/Gist/Fork/Release/Watch/feed refresh | No | Only where existing executor supports it | Source refresh | Relevant list/channel |
| Backend/device sync | No | No artificial cancellation during commit | Source checks actual submission/sync state | Connection settings |
| JSON data import/export | No | No during existing commit/download stage | Source after result verification | Data settings |
| Backup/restore | No | No artificial cancellation; restore exposes committing stage | Source verifies applied sections; partial restore errors preserved | Backup settings |
| Server task | Server API capability only; interrupted jobs expose resume | Server cancel for queued/running | Original server task ID; pending submission recovery is explicit | Server/source session |

Unsupported controls are not presented as working controls. Stopping preserves completed business results. History deletion does not delete those results.

## Verification

Commands run from the workspace unless marked otherwise:

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run --reporter=json --outputFile=output/task-center-full-regression.json
npm run typecheck
npm run test:electron:agy
npm run test:electron:mcp
npm run test:electron:plugins
npm run test:electron:webdav
npx vite build --logLevel error
npm run check:bundle-size

# In server/
npx vitest run --reporter=json --outputFile=../output/task-center-backend-regression.json

# UI audit requires a running Vite server and Playwright in NODE_PATH.
node scripts/audit-task-center.cjs
```

- Frontend: 2943/2943 passed, zero failures; `output/task-center-full-regression.json`.
- Backend: 358 tests passed; `output/task-center-backend-regression.json`.
- Electron AGY: 47 tests passed. Electron MCP: 33 tests passed. Plugin/WebDAV regressions passed.
- Typecheck, production Vite build and bundle budget passed. Existing third-party eval/mixed-import/chunk-size warnings are not new task-center failures.
- UI: 8 combinations (zh/en x light/dark x 390/1280), no detected overflow or page errors; 35 records retained after reload; unfinished local records marked interrupted; Escape returns focus to the task trigger.
- UI evidence: `output/playwright/task-center/report.json` and per-viewport list/detail/drawer screenshots.
- New focused coverage includes stale legacy migration, persistence failure, mixed outcomes, explicit pending recovery, invalid pending metadata, running-task retry prevention, local Release cache races, background completion, account change and report exclusions.

## Budget And Known Limits

- Rechecked ledger: **170/170**, not the handed-over 166/170. Calls 167-170 are recorded as `workbench-overview-20261002` in `output/agy-generation-ledger.jsonl`.
- This task-center implementation/continuation made **zero real AGY calls**. No extra authorization assumed. Offline/mock regression and browser checks are not new real-model acceptance evidence.
- Runtime requests/control handlers are not resurrected across application restart; supported batches submit only unfinished/failed children as linked retry records. Not every executor supports arbitrary checkpoint resume.
- Page-owned refresh/search/plugin operations can still cancel or lose their original page view on navigation where that executor requires it; the journal remains visible. Repository/workbench/Gist/Release background support is not a universal guarantee for every operation.
- Server child states come from the currently available server receipt; the adapter does not invent exact per-repository progress or usage. Polling interval is five seconds.
- Old records without start/config/error metadata show "not recorded" rather than reconstructed facts. Device history is not cloud task history or a portable process checkpoint.
- New acceptance focuses on Chinese/English; existing additional locales are retained, and the new overview section uses the application's English fallback there. No new translations for those languages are claimed.
- Browser checks use isolated synthetic data and block external/API requests. They do not constitute an interactive packaged-Electron end-to-end check or a real server disconnect drill.
- Device history keeps successful/canceled unarchived records for 30 days; attention/archive/live records remain until explicitly handled. Long-term growth requires manual history management.

Preview: http://127.0.0.1:5173. Restart the Electron desktop process to pick up main-process retry-profile changes; refreshing only the renderer is insufficient.
