# Discovery UX Delivery - 2026-10-02

## Delivered Behavior

- Builtin and custom repository channels use one-column text blocks and shared detail presentation. No grid mode was added.
- Desktop details dock when sufficient content width is available; narrow windows use an overlay and 390px screens use fullscreen details. Detail tabs and scroll position survive analysis updates.
- Blocks support selection, batch analysis, README, GitHub, questions, Star, and channel-specific actions. Summaries are limited to four lines; unknown metadata is omitted.
- Builtin content analysis defaults to manual. Custom automatic analysis still has a ten-candidate limit per run, independent of subscription verification.
- Custom editing preserves the compiled original plan. Manual overrides survive reparsing; effective rules, summaries, previews, and execution share the same rule resolution. Late previews cannot overwrite a newer edit.
- Core, synonym, and ecosystem branches are distinguished. Ecosystem matches are labeled and do not bypass required-condition evidence.
- Manual approval copies a candidate into today's edition with source information. Original assessments and evidence remain unchanged, and manual approval does not consume the automatic quota.
- Blocking is channel-scoped with undo and restore. Publication preserves unresolved pending candidates and deduplicates across same-day rule revisions.
- Cancellation and pause are channel-owned. Account, rule, and analysis-configuration changes invalidate stale work. Successful prior analysis remains visible when a subsequent attempt fails.
- Structured analysis caches include account, repository, commit time, language, and configuration identity. Atomic task claiming prevents duplicate content analysis across tabs.
- Hot releases require a verified published release in the last fourteen days. Stable releases are the default; prereleases are opt-in. Release checks are bounded and show partial failures.
- Streaming code uses memoized text-based highlighting only for closed fences. Mermaid waits for generation to finish and falls back to copyable source on failure. Chat follows the bottom only while the user is following it.

## Cache-First Reading and Explicit Updates

Channel navigation does not refresh an existing cached list. A channel with no saved result is loaded once, and explicit refresh remains available. Returning to a channel preserves its results and pagination.

Builtin cache expiry only updates an indicator; it issues no request and does not replace, reorder, or clear the list. The indicator tooltip distinguishes expired cache from confirmed new upstream content. Clicking it explicitly refreshes the selected channel. TTLs are one hour for trending/hot releases, six hours for popularity/topics/weekly, twenty-four hours for search, and thirty minutes for social feeds.

Custom daily scheduling remains independent of navigation. A newly saved edition displays an update indicator while the current edition, selection, and details remain stable. Clicking the indicator opens that saved edition without rerunning discovery. Manual refresh follows the requested run. Same-edition human decisions can update immediately; an automatic publication with a new identity cannot silently replace the edition being read.

## Verification

| Check | Result |
| --- | --- |
| Full frontend Vitest run | 255 files, 2,742 tests passed |
| Full server Vitest run | 38 files, 358 tests passed |
| Final cache/navigation/picker regression rerun | 5 files, 21 tests passed |
| Frontend typecheck | Passed, rerun after final changes |
| Server TypeScript build | Passed |
| Vite production build | Passed |
| Latest bundle budget | 1,702.11 KiB largest legacy index; 3,000 KiB limit |
| Module boundary check | Passed |
| Scoped ESLint | No errors; five existing mixed-export Fast Refresh warnings in the edition picker |
| Scoped diff whitespace check | Passed; Git emitted line-ending normalization notices |

Browser checks used an isolated fake account and mocked GitHub/AI responses, not real user credentials. They covered desktop docking and independent scroll, narrow-window overlay, 390px fullscreen details and no horizontal overflow, editor save, copy, multiselect, blocking/undo, approval, batch analysis, manual builtin analysis, and cached navigation with zero search requests.

The final update-indicator browser check verified passive builtin expiry, passive custom publication, preserved selection and detail tab, explicit viewing of a saved newer edition, and zero automatic GitHub/AI requests caused by those indicators.

Browser fixtures are under `output/playwright/discovery-ux-setup.js`, `discovery-ux-check.js`, and `discovery-freshness-check.js`. Screenshots use the `discovery-final-*.png` prefix, including `discovery-final-update-hint.png`.

## Performance Evidence and Limits

The same 26,080-character streaming sample was measured with sixty chunks in a foreground React development browser, three alternating rounds after warmup. Total render time was 1,052.9 / 960.2 / 998.3 ms before and 914.3 / 952.5 / 991.6 ms after. P95 render time was 33.0 / 31.0 / 32.1 ms before and 28.5 / 32.9 / 34.5 ms after.

These noisy development measurements do not establish a stable performance improvement. The active answer still reparses its Markdown; existing stream throttling and historical-message isolation remain. The verified improvements here are correct incremental highlighting, deferred diagrams, and reading-position behavior, not incremental Markdown parsing.

Live GitHub limits, provider/proxy latency, real AI responses, and packaged desktop integration were not verified end-to-end in this browser run. Test failures and cancellations are covered with controlled fixtures; a configured real-account smoke test remains advisable before release.

The local Vite development server is available at `http://127.0.0.1:5180`. No commit, push, or release was performed. Unrelated settings/AGY workspace changes were preserved.
