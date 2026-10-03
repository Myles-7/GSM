import { describe, expect, it } from "vitest";
import { mergeChannelEdition } from "../../src/services/customDiscovery.js";
import {
  effectiveRules,
  buildQuery,
  type CustomDiscoveryChannel,
  type ChannelDailyEdition,
  type CandidateAssessment,
} from "../../src/core/customDiscovery.js";
import {
  effectiveRules as desktopRules,
  buildQuery as desktopQuery,
} from "../../../src/features/discovery/custom/model";

const plan = {
  version: 1 as const,
  required: [],
  excluded: [],
  preferred: [],
  branches: [{ terms: ["codex"], readme: false, role: "core" as const }],
  filters: {
    language: null,
    minStars: null,
    maxStars: null,
    createdWithinDays: null,
  },
  filterSources: {
    language: null,
    minStars: null,
    maxStars: null,
    createdWithinDays: null,
  },
  conflicts: [],
};
const channel = (): CustomDiscoveryChannel => ({
  id: "custom:test",
  name: "Tools",
  instruction: "codex",
  revision: 1,
  plan,
  enabled: true,
  paused: false,
  ai: true,
  limit: 1,
  hour: 9,
  cursors: [],
  blocked: [],
  read: [],
  recommended: {},
});
const assessment = (id: number): CandidateAssessment => ({
  repo: {
    id,
    full_name: `owner/repo${id}`,
    description: "codex",
    topics: [],
    language: null,
    stargazers_count: 0,
    created_at: "2020-01-01",
    pushed_at: "2026-09-01",
  },
  verdict: "match",
  reason: "codex",
  evidence: ["original"],
  method: "rules",
  relevance: 1,
  preference: 0,
});
const edition = (): ChannelDailyEdition => ({
  channelId: "custom:test",
  date: "2026-10-02",
  revision: 1,
  instruction: "codex",
  entries: [],
  pending: [],
  errors: [],
  complete: true,
  searched: 1,
  filtered: 0,
  generatedAt: "2026-10-02T01:00:00Z",
});
describe("desktop/server discovery contract", () => {
  it("agrees on semantic/filter overrides, branch provenance and generated queries", () => {
    const overrides = {
      minStars: null,
      scope: "metadata" as const,
      required: [{ text: "offline", source: "manual" }],
      branches: [
        { terms: ["openai"], readme: false, role: "ecosystem" as const },
      ],
    };
    expect(effectiveRules(plan, overrides)).toEqual(
      desktopRules(plan, overrides),
    );
    expect(buildQuery(plan, 0, false, new Date("2026-10-02"), overrides)).toBe(
      desktopQuery(plan, 0, false, new Date("2026-10-02"), overrides),
    );
  });
  it("preserves manually accepted entries, unresolved history and excludes manual acceptance from automatic quota", () => {
    const c = channel();
    c.recommended = { "1": "2026-10-02" };
    c.manualAccepted = { "1": "2026-10-02" };
    const previous = edition();
    previous.entries = [
      {
        ...assessment(1),
        verdict: "unknown",
        acceptance: {
          sourceEditionKey: "old",
          sourceRevision: 1,
          acceptedAt: "today",
        },
      },
    ];
    previous.pending = [{ ...assessment(4), verdict: "unknown" }];
    const before = structuredClone(previous);
    const fresh = edition();
    fresh.entries = [assessment(1), assessment(2), assessment(3)];
    fresh.pending = [{ ...assessment(5), verdict: "unknown" }];
    const merged = mergeChannelEdition(c, fresh, previous);
    expect(previous).toEqual(before);
    expect(merged.edition.entries.map((item) => item.repo.id)).toEqual([1, 2]);
    expect(merged.edition.pending.map((item) => item.repo.id)).toEqual([4, 5]);
    expect(merged.recommended).toEqual({
      "1": "2026-10-02",
      "2": "2026-10-02",
    });
    const repeated = mergeChannelEdition(
      { ...c, recommended: merged.recommended },
      fresh,
      merged.edition,
    );
    expect(repeated.edition.entries.map((item) => item.repo.id)).toEqual([
      1, 2,
    ]);
  });
  it("enforces same-day cross-revision quota and removes only positively rejected pending projects", () => {
    const c = channel();
    c.recommended = { "9": "2026-10-02" };
    c.ruleOverrides = { excludeRecommended: false };
    c.blocked = [6];
    const previous = edition();
    previous.pending = [4, 5, 6].map((id) => ({
      ...assessment(id),
      verdict: "unknown",
    }));
    const fresh = edition();
    fresh.entries = [assessment(10)];
    fresh.revision = 2;
    const merged = mergeChannelEdition(c, fresh, previous, [5]);
    expect(merged.edition.entries).toEqual([]);
    expect(merged.edition.pending.map((item) => item.repo.id)).toEqual([4]);
  });
});
