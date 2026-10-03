# Discovery Long-Term Reading Delivery

## Behavior

- Discovery keeps the existing single-column text blocks and channel navigation.
- A saved channel opens from local data, with its loaded range and source cursor.
  Cache expiration only offers an update; it does not replace the reading queue.
- Most-popular refresh updates known projects and appends new projects without
  removing or reordering the existing queue. Explicit ranking reorder stages a
  complete replacement, then restores the original project anchor when possible.
- Ranking collection is capped at five source requests and 60 seconds per run.
  Duplicates do not count toward the loaded range. Partial reorder never publishes
  a half-finished list; the next explicit attempt continues its staged progress.
- Reading anchors use stable item identity and viewport offset, not rank.
  Repository, message and code-result identities are distinct. Custom-channel
  depth and anchors are scoped by edition date, rule revision and result tab.
- Detail panels dock on wide content areas, independently scroll and contain
  scroll boundaries. Header, tabs, README, links and analysis actions remain fixed.
  Narrow windows use an overlay; the mobile detail and settings panels fill the screen.
- Channel settings contain resume reading, manual/automatic loading, 20/50/100
  item batches, automatic analysis and its 1-10 limit. Unsupported options are hidden.
  Changing batch size never truncates the queue. Automatic loading requires active
  downward browsing, ignores detail/dialog input and stops after a loading failure.

## Shared Analysis

- Account-bound successful analysis is stored separately from reading caches,
  history retention and model-task leases. There is no TTL-based removal.
- Display prefers the requested language, with a marked fallback to another
  successful language. Unlabelled legacy successes use an unknown-language marker.
- Commit, configuration and schema changes only affect freshness icons/tooltips.
  Automatic analysis and analyze-unanalysed actions skip saved successes, stale
  results included. Explicit reanalysis requires confirmation; failure keeps success.
- Discovery and repository detail analysis share successful assets and atomic task
  leases. Star reads the newest asset after its request; a later analysis completion
  also updates an already-starred repository without replacing personal fields.
- Deleting analysis invalidates queued late writes and requires confirmation.
  The confirmation warns that shared results affect other channels and the repository
  page. Clearing a reading list does not remove Stars, subscription history or analysis.

## Storage And Portability

- IndexedDB normalizes sessions, project rows, preferences and anchors; analysis
  has its own normalized asset/metadata stores. Zustand remains a runtime projection.
- Queue and cursor commit in the same transaction. Version guards reject stale
  replacements; append cursors and ranking stages do not regress across tabs.
  Failed storage retains in-memory results and surfaces an unsaved state.
- JSON and WebDAV include an optional versioned discovery workspace, preferences,
  anchors, custom history and analysis assets. Credentials, leases and running tasks
  are excluded. Cross-account imports fail validation before writes; old backups
  without the optional block do not clear newer local data.
- Identity migration coordinates the new stores with existing recovery journals,
  including interrupted cross-database migration and old-journal compatibility.
- Local retention is not a cloud guarantee: deleting application/browser data can
  still remove it. JSON/WebDAV backups are the portable recovery mechanism.

## Verification

- Final full frontend snapshot: 2,948 tests passed, zero failures.
- Final integration regression snapshot: 67 tests passed.
- Server snapshot: 358 tests passed.
- Type checking, scoped ESLint, module boundaries and production build passed.
  Legacy entry bundle: 1,794.28 KiB against the 3,000 KiB budget.
- Browser fixtures: restored 60 projects/cursor page 4, zero entry/reopen searches,
  anchor offset delta 0; append, stable refresh and explicit reorder retained 80.
- Custom-channel fixtures: 20 to 40 projects, independent result-tab depth,
  channel-switch anchor offset delta 0. Desktop, narrow-window and 390px screenshots
  checked detail scrolling, fixed controls and absence of horizontal overflow.
- GitHub public read-only search returned HTTP 200. Browser GitHub, AI and Star
  flows used a fake account and mocked responses. No paid model or authenticated
  real Star write was executed; those are not claimed as live end-to-end validation.
- Build emitted existing third-party eval and mixed dynamic/static import warnings;
  they were warnings, not build failures. The test runtime also emitted a
  localStorage-file configuration warning. No new dependency was installed.
- Artifacts: `output/discovery-reading-vitest-final.json`,
  `output/discovery-reading-post-integration.json`,
  `output/discovery-reading-server-vitest.json`,
  `output/playwright/discovery-reading-check.js`,
  `output/playwright/discovery-custom-reading-check.js`, and matching screenshots.
