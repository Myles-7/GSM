# AGY concurrency benchmark (2026-09-29)

## Method

- Current device model: `gemini-3.8-flash-high`; effort: `high`; request timeout: 180 seconds.
- Five synthetic repository summaries per level, same evidence and checks, independent CLI processes/workspaces, no retries.
- Production transport used directly; production queue and settings were not changed. This is not scheduler/UI end-to-end verification.
- Checks: Chinese summary length, Markdown purpose, documented platforms, negative capabilities, unknown macOS support, exact commands, migration direction, project identity, and tags. Saved answers were also inspected for factual consistency.
- Twenty calls started, cumulative ledger now 150/170. No additional generation is needed to read these results.

## Results

| Concurrent requests | Batch seconds | Mean request seconds | Checks passed | Reported total tokens |
| --- | ---: | ---: | ---: | ---: |
| 1 | Unavailable | 21.29 (four completed transport records) | Full results unavailable | Incomplete |
| 2 | 70.564 | 22.880 | 5/5 | 43,729 |
| 3 | 50.833 | 26.042 | 5/5 | 46,015 |
| 5 | 38.457 | 26.296 | 5/5 | 36,421 |

The original serial run was interrupted after five calls started. Four successful transport records survive, but complete answer artifacts and batch timing do not. It is excluded from batch speedup comparisons. The interrupted fifth call is not counted as a model failure or success.

No timeout, rate-limit error, malformed JSON, or failed content check occurred in the fifteen completed concurrent tasks. Five concurrency reduced batch time by 24.3% relative to three, and 45.5% relative to two. Mean request latency at five was about 15% higher than at two; better throughput does not mean every individual request gets faster.

## Recommendation

Use three as a conservative general default and expose five as an optional batch-summary setting. The observed fastest setting was five; this recommendation of three for general use is a cautious product choice, not evidence that three is more reliable. For this user's speed-focused short-summary batches, five is a reasonable trial setting.

Before production enablement, implement a global generation pool, keep configuration operations exclusive, preserve owner/request cancellation and queue deadlines, and ensure batch callers actually submit multiple tasks. Add rate-limit backoff and interactive-request priority. Do not merely increase the batch worker count while retaining the serial Electron queue.

## Limits and reproduction

One fixed-order run per level, five highly similar short tasks, no repeated trials or long research workload. Network/provider variability and warm-up effects are not controlled. Token usage varied, including larger input accounting on some initial requests; no pricing or token-efficiency conclusion follows. CPU/RAM peaks were not measured. These results do not establish sustained five-way reliability, research quality, or resource headroom.

Artifacts: `output/agy-concurrency-benchmark.json`, `output/agy-generation-ledger.jsonl`, and `output/agy-generation-usage.jsonl`.

Script: `scripts/benchmark-agy-concurrency.cjs`. Its 20-call guard intentionally prevents a fresh rerun against this ledger. Do not delete accounting records to bypass it; a new authorized benchmark should use a separately identified run and explicit budget.
