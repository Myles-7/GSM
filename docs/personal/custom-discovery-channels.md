# Custom Discovery Channels

Custom channels appear alongside the built-in Discovery channels. Use the plus
button, enter a name and natural-language request, then parse it. Saving is
available immediately after successful parsing; the candidate preview is optional
and never blocks saving. Parsing needs an active AI configuration. Editing
already-compiled filters does not require another AI call.

## Editor and Request Bounds

- Templates fill editable text without making requests. Common filters are
  expanded, advanced filters are collapsed, and the action footer stays fixed.
- Manual options override parsed values, which override defaults. Missing values
  mean follow the parser; explicit null means unlimited. Original plans remain
  stored separately from overrides, and effective-rule changes increment revision.
- Editing the request invalidates its compilation; changing options only
  invalidates preview. Core and extra search branches can be edited or removed.
- Parsing has a 60-second deadline. Preview has a 30-second overall deadline,
  at most three searches and ten candidates, with no README requests or AI judging.
  Candidates are not presented as verified recommendations.
- Search and README calls have 15-second deadlines; each daily AI batch has a
  60-second deadline. Cancellation propagates to direct/proxy requests and waits.
  Late results cannot update the editor. Daily runs retain completed work on timeout.
- GitHub quota state is separated by resource. Positive remaining quota does not
  trigger a reset wait; exhausted quota or server Retry-After is surfaced as cooldown.
- Daily progress reports search, README, screening and publication stages.
  Failures and incomplete runs are distinguished from a successful empty result.

## Behavior

- Custom results use a single-column repository-style text-block list, never a
  grid. Shared presentation primitives keep language colors, counts, software
  forms and description treatment aligned with saved repositories.
- Details dock beside results when the content area permits, and use an overlay
  on narrow screens. README, questions, Star, read status, blocking and selection
  remain independent actions; saved-repository management actions are not exposed.
- Auto content analysis is independent of semantic screening. Each formal run
  enqueues at most the first ten ranked candidates; the creation preview does not.
  Candidates are shown as unverified until screening/publication completes.
- Content analysis reuses structured repository details, serializes model calls
  with screening priority, and publishes summaries incrementally. Manual batch
  analysis, pause/resume, cancellation and retry are available. Reanalysis keeps
  the previous successful content if the new request fails.
- Analysis cache and atomic work claims are account-local in IndexedDB, keyed by
  repository, pushed time, language and schema version. Model output does not
  rewrite subscription evidence, historical editions or recommendation dedup.

- Rules distinguish requirements, exclusions and preferences. Model output is
  schema-validated; source excerpts must exist in the original request.
- Search queries are constructed in code. Up to six branches have relevance and
  recent-activity paths. Each run has per-channel and shared search budgets.
- Numeric/language/date filters run before semantic screening. Unknown semantic
  evidence stays in the Unverified tab. AI quotes are checked against supplied
  repository text; this checks provenance, not semantic truth.
- Per-channel deduplication persists after old editions expire. A manual override
  can allow historical repeats, but same-day repeats remain prohibited. Preview results
  do not consume recommendations. Cross-channel matches remain independent.
- Independent IndexedDB account records store channels, editions, evidence cache,
  read/block lists, recommendation history and an expiring cross-window lease.
- Scheduling runs while the application is open, including outside Discovery.
  Startup, focus and online events check whether today's edition is due. Missed
  historical days are not fabricated. Default local hour is 09:00.
- Hiding a channel does not pause scheduling. Pausing retains history. Deleting
  removes local channel history, never GitHub stars.

## Validation

Latest targeted Vitest regression run: 151 tests passing across discovery,
repository cards/detail panels, detail analysis and GitHub deadline behavior.
New coverage includes the ten-candidate cap, analysis cache reuse, preservation
after reanalysis failure, cancellation, competing claims, scheduling priority,
list interactions and injected detail actions.
TypeScript, scoped ESLint, frontend-boundary checks and a production build passed.
Isolated browser fixtures verified creation, interpretation, preview, publication,
history readback, pause/resume, and desktop/mobile layout (390px without overflow).
Browser artifacts are in `output/playwright/`.
The `custom-blocks-*` fixtures verify docked desktop details, 390px layouts,
batch-generated summaries, preserved detail tabs and selection reset using
isolated mock GitHub/model responses.

## Remaining Validation

Real GitHub/model-provider calls were not exercised with user credentials.
The complete multi-window IndexedDB failure/recovery and long-duration timezone
matrix still needs end-to-end coverage; current unit tests cover publication
lease ownership, stale revisions, retention and idempotence as pure transitions.
Semantic quality depends on the configured model. The bounded search is not an
exhaustive GitHub crawl. Non-Chinese UI currently uses English fallback labels
for the new custom-channel screens.
