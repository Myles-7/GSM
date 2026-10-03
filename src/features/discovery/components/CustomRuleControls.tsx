import type { RuleOverrides, EffectiveRules } from "../custom/model";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const languages = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C#",
  "C++",
  "Swift",
  "Kotlin",
  "Dart",
];
type Props = {
  overrides: RuleOverrides;
  rules: EffectiveRules | null;
  change: (value: RuleOverrides) => unknown;
  zh: boolean;
};

export function CustomRuleControls({ overrides, rules, change, zh }: Props) {
  const l = (cn: string, en: string) => (zh ? cn : en);
  const patch = (key: keyof RuleOverrides, value: unknown) => {
    const next = { ...overrides };
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
    change(next);
  };
  const numeric = (
    key: "minStars" | "maxStars" | "createdWithinDays",
    title: string,
  ) => {
    const value = overrides[key];
    const effective = rules?.plan.filters[key];
    return (
      <div className="min-w-0 space-y-1">
        <label className="text-xs font-medium" htmlFor={`rule-${key}`}>
          {title}
        </label>
        <div className="flex gap-2">
          <select
            id={`rule-${key}`}
            className={selectClass}
            value={
              value === undefined ? "inherit" : value === null ? "any" : "value"
            }
            onChange={(e) =>
              patch(
                key,
                e.target.value === "inherit"
                  ? undefined
                  : e.target.value === "any"
                    ? null
                    : key === "createdWithinDays"
                      ? 30
                      : 0,
              )
            }
          >
            <option value="inherit">
              {l("跟随解析", "Follow parsed")} ({effective ?? l("不限", "Any")})
            </option>
            <option value="any">{l("不限", "Any")}</option>
            <option value="value">{l("指定数值", "Set value")}</option>
          </select>
          {typeof value === "number" && (
            <input
              aria-label={`${title}${l("数值", " value")}`}
              type="number"
              min={key === "createdWithinDays" ? 1 : 0}
              max={key === "createdWithinDays" ? 36500 : undefined}
              value={value}
              className="h-9 w-24 shrink-0 rounded-md border bg-background px-2 text-sm"
              onChange={(e) => {
                if (e.target.value !== "") patch(key, Number(e.target.value));
              }}
            />
          )}
        </div>
        {value !== undefined && (
          <span className="text-xs text-muted-foreground">
            {l("手动覆盖", "Manual override")}
          </span>
        )}
      </div>
    );
  };
  const language = overrides.language;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <label htmlFor="rule-language" className="text-xs font-medium">
            {l("编程语言", "Language")}
          </label>
          <select
            id="rule-language"
            className={selectClass}
            value={
              language === undefined
                ? "inherit"
                : language === null
                  ? "any"
                  : languages.includes(language)
                    ? language
                    : "custom"
            }
            onChange={(e) =>
              patch(
                "language",
                e.target.value === "inherit"
                  ? undefined
                  : e.target.value === "any"
                    ? null
                    : e.target.value === "custom"
                      ? "Other"
                      : e.target.value,
              )
            }
          >
            <option value="inherit">
              {l("跟随解析", "Follow parsed")} (
              {rules?.plan.filters.language || l("不限", "Any")})
            </option>
            <option value="any">{l("不限", "Any")}</option>
            {languages.map((name) => (
              <option key={name}>{name}</option>
            ))}
            <option value="custom">{l("其他语言", "Other language")}</option>
          </select>
          {language && !languages.includes(language) && (
            <input
              aria-label={l("其他语言", "Other language")}
              className={selectClass}
              value={language}
              onChange={(e) => patch("language", e.target.value)}
            />
          )}
          {language !== undefined && (
            <span className="text-xs text-muted-foreground">
              {l("手动覆盖", "Manual override")}
            </span>
          )}
        </div>
        {numeric("minStars", l("最低 Stars", "Minimum stars"))}
        {numeric(
          "createdWithinDays",
          l("创建时间（最近天数）", "Created within days"),
        )}
        <label className="min-w-0 space-y-1 text-xs font-medium">
          {l("排序偏好", "Sort preference")}
          <select
            className={`${selectClass} mt-1`}
            aria-label={l("排序偏好", "Sort preference")}
            value={overrides.sort ?? "inherit"}
            onChange={(e) =>
              patch(
                "sort",
                e.target.value === "inherit" ? undefined : e.target.value,
              )
            }
          >
            <option value="inherit">{l("跟随解析", "Follow parsed")}</option>
            <option value="relevance">{l("相关性", "Relevance")}</option>
            <option value="stars">{l("Stars 最多", "Most stars")}</option>
            <option value="updated">{l("近期活跃", "Recent activity")}</option>
          </select>
        </label>
      </div>
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">
          {l("进阶选项", "Advanced options")}
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {numeric("maxStars", l("最高 Stars", "Maximum stars"))}
          <label className="space-y-1 text-xs font-medium">
            {l("检索字段", "Search fields")}
            <select
              className={`${selectClass} mt-1`}
              aria-label={l("检索字段", "Search fields")}
              value={overrides.scope ?? "inherit"}
              onChange={(e) =>
                patch(
                  "scope",
                  e.target.value === "inherit" ? undefined : e.target.value,
                )
              }
            >
              <option value="inherit">{l("跟随解析", "Follow parsed")}</option>
              <option value="metadata">
                {l("名称、描述、Topics", "Name, description, topics")}
              </option>
              <option value="readme">README</option>
              <option value="all">{l("全部字段", "All fields")}</option>
            </select>
            <span className="block text-xs font-normal text-muted-foreground">
              {l("当前", "Current")}:{" "}
              {rules?.scope === "all"
                ? l("全部字段", "All fields")
                : rules?.scope === "readme"
                  ? "README"
                  : l("名称、描述、Topics", "Name, description, topics")}
            </span>
          </label>
          {(
            [
              "excludeArchived",
              "excludeForks",
              "excludeStarred",
              "excludeRecommended",
            ] as const
          ).map((key, index) => (
            <label key={key} className="space-y-1 text-xs font-medium">
              {
                [
                  l("排除归档", "Exclude archived"),
                  l("排除 Fork 仓库", "Exclude forks"),
                  l("排除已 Star", "Exclude starred"),
                  l("排除本频道已推荐", "Exclude previously recommended"),
                ][index]
              }
              <select
                aria-label={
                  [
                    l("排除归档", "Exclude archived"),
                    l("排除 Fork 仓库", "Exclude forks"),
                    l("排除已 Star", "Exclude starred"),
                    l("排除本频道已推荐", "Exclude previously recommended"),
                  ][index]
                }
                className={`${selectClass} mt-1`}
                value={
                  overrides[key] === undefined
                    ? "inherit"
                    : String(overrides[key])
                }
                onChange={(e) =>
                  patch(
                    key,
                    e.target.value === "inherit"
                      ? undefined
                      : e.target.value === "true",
                  )
                }
              >
                <option value="inherit">
                  {l("跟随解析", "Follow parsed")} (
                  {rules?.[key] === false
                    ? l("包含", "Include")
                    : l("排除", "Exclude")}
                  )
                </option>
                <option value="true">{l("排除", "Exclude")}</option>
                <option value="false">{l("包含", "Include")}</option>
              </select>
            </label>
          ))}
        </div>
      </details>
    </>
  );
}
