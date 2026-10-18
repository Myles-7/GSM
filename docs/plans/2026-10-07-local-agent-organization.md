# Local Agent Organization

## Implementation

GSM exposes an authenticated loopback MCP endpoint for external agent conversations. The desktop endpoint remains available while Desktop Home/backend mode is active. The existing backend MCP remains a separate, unchanged read endpoint.

The agent reads account-scoped metadata and evidence, edits a dual-scheme draft, and opens the existing organization preview. It cannot apply classifications, authorize locked moves, modify stars, labels, personal descriptions, or GitHub Lists. No model is started by these tools.

Desktop MCP uses the existing preference and port. Backend enablement and tokens are now kept separate in the settings hook instead of overwriting desktop preferences. Actual listener state/address, not merely configured values, determines the connection indicator.

## Connecting Codex

Keep GSM running. In Settings > MCP, enable **Desktop Organization Connection**, then copy the expanded **Codex Configuration** example into the client's MCP configuration. GSM does not change the Codex configuration automatically. Treat the copied example as a secret because it contains the local access token.

The example uses a `[mcp_servers.gsm-local]` table, a loopback HTTP `url`, and a static Authorization header. The local and backend endpoints are different: organization tools exist on the desktop endpoint, not the backend endpoint.

Suggested conversation:

> Use GSM to organize my GitHub repository library. First read the current account, both classification schemes and existing drafts. Continue the latest compatible draft by default. You may freely design purpose and technology categories, preferring clear names and avoiding unnecessary tiny groups. Reuse cached evidence; fetch README only when needed. Preserve my manual choices. Save each accepted batch to the draft, list uncertainty explicitly, then open the GSM preview. Do not apply classifications.

The protocol imposes bounded tool payloads, not a fixed model pipeline. The agent chooses its own reasoning steps and model requests. GSM does not record or claim access to the agent's private reasoning or full conversation.

## Tools And Compatibility

| Tool | Purpose |
| --- | --- |
| `gsm_organization_overview` | Current account, both category trees, recent drafts |
| `gsm_organization_repositories` | Paginated metadata and scheme memberships |
| `gsm_organization_evidence` | Cached facts, optional cached/deduplicated README retrieval |
| `gsm_organization_start` | New task or linked revision of a compatible existing draft |
| `gsm_organization_checkpoint` | Revision, structure, coverage and paginated assignments |
| `gsm_organization_edit` | Atomic structure/assignment suggestions, progress message |
| `gsm_organization_review` | Coverage, current conflicts and deferred operations |
| `gsm_organization_open_preview` | Open the exact draft for human review |

Call overview first and pass its `ownerId` to subsequent tools. Writes require `taskId`, `expectedRevision` (the checkpoint's `updatedAt` token), and a stable `requestId`. Repeat that same request ID after an uncertain response; never blindly submit a new one. Changed content must use a different ID. The newest 100 edit receipts are retained; older duplicate writes still fail revision checks.

Category creation supports request-local `ref` aliases. Later edits and assignments in the same call may refer to them; the reply maps `schemeId:ref` to GSM-generated stable IDs. Requests accept up to 50 category edits and 100 repository/scheme assignments. These limits do not restrict total task scope.

Main categories and subcategories support creation and rename. Merge sources must share the destination's level and parent; subgroup merging retains main membership and existing locks. The existing confirmation/recovery transaction now supports these subgroup merges. Nonexistent explicit targets fail instead of silently creating a destination. External-draft writes from both GSM and tools use atomic expected-revision checks, including preparation of application.

Both schemes preserve unique main/subcategory membership. A locked cross-main move is visible but unselected and unauthorized. Uncertain items must retain their before-membership, remain unselected, and include a reason. Counts distinguish processed, valid, uncertain and missing; structural validation is not proof of factual classification quality.

A new optional `externalAgent` field lives in the existing version-3 draft and backup schema. No new database, persistence-version bump, or category migration is required. Archived/legacy records are not silently converted. Restarting never dispatches a model call or classification write.

## Validation And Delivery

The synthetic native-shell fixture uses a fresh profile, blocks GitHub/model/backend requests, exercises a standard MCP SDK handshake, edits both schemes for ten repositories, opens the existing preview, and verifies that real Store classifications remain unchanged. Screenshots cover desktop/narrow review, confirmation and settings.

Focused verification covers account isolation, invalid targets, partial/missing coverage, duplicate IDs and idempotent requests, stale revisions, manual protection, locked moves, cancellation, active applications, confirmed application/recovery and atomic IndexedDB compare-and-save. Existing Electron MCP/trust regressions are retained.

Do not claim a Codex conversation is verified merely because the SDK handshake or configuration parser passed. The actual Codex desktop conversation and real-model classification are separate acceptance gates. The installed CLI's existing model catalog currently reports a missing `base_instructions` field; this unrelated configuration is not modified by GSM.

### Recorded Results (2026-10-07)

- Typecheck, targeted ESLint, i18n and frontend boundaries passed.
- Five focused Vitest files: 43 passed. Electron MCP/trust suite: 50 passed.
- Native SDK handshake, dual drafts for ten synthetic repositories, idempotent edit, preview and unchanged classifications passed; isolated Codex CLI MCP configuration parsing passed. No real model or real-account categorization was requested.
- Desktop/narrow preview, confirmation and desktop-settings screenshots were captured during the first successful smoke run. A later protocol rerun omitted screenshots; screenshot coverage is not a claim that every subsequent service-only patch was visually revalidated.
- An expanded legacy-generator test run also found one failure: `aiOrganizationDual.test.ts` / whole-task request cap throws `Task model request limit reached`. Both that test and its generator match the pre-task recovery copy; this is not fixed or counted as a passed gate in this work.
- Real Codex desktop and CLI conversations remain unverified. The installed user CLI configuration fails catalog parsing (`base_instructions` missing); only an isolated `CODEX_HOME` was used to verify the MCP example. User configuration was not modified.

The recovery copy is outside Git at `D:/GSM-backups/local-agent-20261007-184640`. After the user confirmed desktop exit, the offline Electron profile, old `dist`, server encryption key and SQLite online backup (including committed WAL data) were saved there. The latest `output/local-agent-dist` build passed, replaced actual `dist`, and its index hash matched. The original `start-desktop.vbs` entry was launched; the new process logged `D:/桌面/GSM/dist/index.html` as its loading source. The task-owned 5207 server was stopped, and the other 5174 listener was preserved. No push or installer was produced. Restoring data should use the matching private backup, never just a code rollback.
