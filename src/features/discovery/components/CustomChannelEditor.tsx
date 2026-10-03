import { useState } from "react";
import {
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
  Save,
} from "lucide-react";
import { Modal } from "../../../components/Modal";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { useAppStore } from "../../../store/useAppStore";
import { useCustomChannelEditor } from "../hooks/useCustomChannelEditor";
import type { CustomDiscoveryChannel } from "../custom/model";
import { issueLabel, progressLabel } from "../custom/taskStatus";
import { CustomRuleControls } from "./CustomRuleControls";

export function CustomChannelEditor({
  channel,
  onClose,
}: {
  channel?: CustomDiscoveryChannel;
  onClose: () => void;
}) {
  const zh = useAppStore((s) => s.language.startsWith("zh"));
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const l = (cn: string, en: string) => (zh ? cn : en);
  const e = useCustomChannelEditor(channel, onClose);
  const [template, setTemplate] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kind, setKind] = useState<
    "required" | "excluded" | "preferred" | "branch"
  >("required");
  const [term, setTerm] = useState("");
  const close = () => {
    e.cancel();
    onClose();
  };
  const templates = [
    [
      l("指定产品生态", "Product ecosystem"),
      l("查找 codex 相关的项目", "Find projects related to codex"),
    ],
    [
      l("开发工具", "Developer tools"),
      l(
        "关注 AI 编程助手、代码检索和审查工具，排除教程和示例项目",
        "AI coding assistants, code search and review tools; exclude tutorials and demos",
      ),
    ],
    [
      l("本地 AI", "Local AI"),
      l(
        "关注能本地运行的 AI 效率工具，Windows 优先，不要教程和资源合集",
        "Local AI productivity tools, Windows preferred; exclude tutorials and resource lists",
      ),
    ],
    [
      l("新项目", "New projects"),
      l(
        "关注近 30 天新建的 AI Agent 项目，至少 20 Stars",
        "AI agent projects created in the last 30 days with at least 20 stars",
      ),
    ],
  ];
  const groups = {
    required: l("必要条件", "Required"),
    excluded: l("排除条件", "Excluded"),
    preferred: l("排序偏好", "Preferred"),
  };
  const add = () => {
    const accepted =
      kind === "branch" ? e.addBranch(term) : e.addCondition(kind, term);
    if (accepted) setTerm("");
  };
  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" disabled={e.saving} onClick={close}>
        {l("取消", "Cancel")}
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!e.canSave || e.previewing}
          onClick={() => {
            setDrawerOpen(true);
            void e.previewCandidates();
          }}
        >
          <Search className="mr-1.5 h-4 w-4" />
          {l("预览候选", "Preview candidates")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!e.canSave}
          onClick={() => void e.save(false)}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {l("保存配置", "Save config")}
        </Button>
        <Button
          size="sm"
          aria-label={l("保存频道", "Save channel")}
          disabled={!e.canSave}
          onClick={() => void e.save(true)}
        >
          {e.saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" />
          )}
          {l("保存并执行", "Save and run")}
        </Button>
      </div>
    </div>
  );
  return (
    <Modal
      isOpen
      onClose={close}
      title={
        channel
          ? l("编辑自定义频道", "Edit custom channel")
          : l("新建自定义频道", "New custom channel")
      }
      maxWidth="max-w-3xl"
      scrollable
      footer={footer}
    >
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            {l("频道名称", "Channel name")}
            <Input
              aria-label={l("频道名称", "Channel name")}
              maxLength={80}
              value={e.name}
              onChange={(event) => e.setName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            {l("需求模板", "Template")}
            <select
              aria-label={l("需求模板", "Template")}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value);
                const t = templates[Number(event.target.value)];
                if (event.target.value !== "" && t) {
                  e.changeInstruction(t[1]);
                  if (!e.name.trim()) e.setName(t[0]);
                }
              }}
            >
              <option value="">{l("不使用模板", "No template")}</option>
              {templates.map(([name], index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-sm font-medium">
          {l("你想关注什么", "What would you like to follow?")}
          <textarea
            aria-label={l("你想关注什么", "What would you like to follow?")}
            className="min-h-24 w-full resize-y rounded-md border bg-background p-3 text-sm font-normal"
            rows={3}
            maxLength={4000}
            value={e.instruction}
            onChange={(event) => e.changeInstruction(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!e.instruction.trim() || e.parsing || e.saving}
            onClick={() => void e.parse()}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            {l("解析需求", "Parse request")}
          </Button>
          {(e.parsing || e.previewing) && (
            <>
              <span role="status" className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                {e.parsing
                  ? l("解析中", "Parsing")
                  : e.progress
                    ? progressLabel(e.progress, zh)
                    : l("预览中", "Previewing")}{" "}
                · {e.elapsed}s
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={l("取消任务", "Cancel task")}
                onClick={e.cancel}
              >
                <X className="mr-1 h-4 w-4" />
                {l("取消任务", "Cancel task")}
              </Button>
            </>
          )}
          {e.plan && e.stale && (
            <span role="status" className="text-xs text-amber-600">
              {l("需求已变化，请重新解析", "Request changed; parse again")}
            </span>
          )}
        </div>
        {e.issue && (
          <div role="alert" className="break-words text-sm text-destructive">
            {issueLabel(e.issue, zh)}
            {e.issue.kind === "auth" && (
              <Button
                variant="link"
                onClick={() => {
                  sessionStorage.setItem("gsm:pending-settings-tab", "ai");
                  setCurrentView?.("settings");
                  window.dispatchEvent(
                    new CustomEvent("gsm:navigate-to-settings-tab", {
                      detail: { tab: "ai" },
                    }),
                  );
                  close();
                }}
              >
                {l("前往 AI 配置", "Configure AI")}
              </Button>
            )}
          </div>
        )}
        {!!e.conflicts.length && (
          <div role="alert" className="text-sm text-destructive">
            {e.conflicts.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        )}
        {e.rules && (
          <section
            className="space-y-3 border-t pt-3"
            aria-label={l("有效规则", "Effective rules")}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {l("规则摘要", "Rule summary")}
              </h3>
              {e.canResetConditions && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e.resetPlanConditions}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  {l("恢复解析条件", "Restore parsed conditions")}
                </Button>
              )}
            </div>
            {(["required", "excluded", "preferred"] as const).map(
              (group) =>
                e.rules!.plan[group].length > 0 && (
                  <div key={group} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {groups[group]}
                      {e.overrides[group] !== undefined &&
                        ` · ${l("手动覆盖", "Manual override")}`}
                    </p>
                    <ul className="space-y-1">
                      {e.rules!.plan[group].map((c, index) => (
                        <li
                          key={`${index}:${c.text}`}
                          className="flex min-w-0 items-start justify-between gap-2 text-sm"
                        >
                          <span className="break-words">{c.text}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label={`${l("删除", "Remove")}${groups[group]} ${c.text}`}
                            onClick={() => e.removeCondition(group, index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {l(
                  "检索分支（分支间为或）",
                  "Search branches (OR between branches)",
                )}
              </p>
              {e.rules.plan.branches.map((branch, index) => (
                <div
                  key={index}
                  className="flex min-w-0 flex-wrap items-center gap-2"
                >
                  <select
                    aria-label={`${l("分支类型", "Branch type")} ${index + 1}`}
                    className="h-7 rounded-md border bg-background px-1 text-xs"
                    value={branch.role ?? (index === 0 ? "core" : "synonym")}
                    onChange={(event) =>
                      e.changeOverrides({
                        ...e.overrides,
                        branches: e.rules!.plan.branches.map((b, i) =>
                          i === index
                            ? {
                                ...b,
                                role: event.target.value as
                                  "core" | "synonym" | "ecosystem",
                              }
                            : b,
                        ),
                      })
                    }
                  >
                    <option value="core">{l("核心", "Core")}</option>
                    <option value="synonym">{l("同义", "Synonym")}</option>
                    <option value="ecosystem">
                      {l("生态扩展", "Ecosystem")}
                    </option>
                  </select>
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {branch.terms.join(l(" 且 ", " AND "))}
                    {branch.readme && !e.rules!.scope && " · README"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={e.rules!.plan.branches.length <= 1}
                    aria-label={`${l("删除分支", "Remove branch")} ${index + 1}`}
                    onClick={() => e.removeBranch(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label={l("新条件类型", "New condition type")}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                {Object.entries(groups).map(([key, name]) => (
                  <option value={key} key={key}>
                    {name}
                  </option>
                ))}
                <option value="branch">{l("检索分支", "Search branch")}</option>
              </select>
              <Input
                className="min-w-0 flex-1 basis-40"
                aria-label={l("新条件或关键词", "New condition or terms")}
                placeholder={l("输入规则或关键词", "Condition or terms")}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    add();
                  }
                }}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={l("添加条件", "Add condition")}
                disabled={!term.trim()}
                onClick={add}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {l("原文依据", "Original interpretation")}
              </summary>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {(["required", "excluded", "preferred"] as const).flatMap(
                  (group) =>
                    e.plan![group].map((c, index) => (
                      <p key={`${group}:${index}`} className="break-words">
                        {groups[group]}: {c.text} ({c.source})
                      </p>
                    )),
                )}
              </div>
            </details>
          </section>
        )}
        <section className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-semibold">
            {l("常用选项", "Common options")}
          </h3>
          <CustomRuleControls
            overrides={e.overrides}
            rules={e.rules}
            change={e.changeOverrides}
            zh={zh}
          />
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={e.ai}
                onChange={(event) => e.setAI(event.target.checked)}
              />
              {l("AI 精筛", "AI screening")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={e.autoAnalyze}
                onChange={(event) => e.setAutoAnalyze(event.target.checked)}
              />
              {l("自动 AI 内容分析", "Automatic content analysis")}
            </label>
          </div>
        </section>
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {l("更新设置", "Update settings")}
          </summary>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="space-y-1 text-xs">
              {l("每日数量", "Daily limit")}
              <input
                aria-label={l("每日数量", "Daily limit")}
                type="number"
                min={1}
                max={40}
                className="ml-2 h-9 w-20 rounded-md border bg-background px-2"
                value={e.limit}
                onChange={(event) =>
                  e.setLimit(
                    Math.max(1, Math.min(40, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <label className="space-y-1 text-xs">
              {l("更新时间", "Update time")}
              <select
                aria-label={l("更新时间", "Update time")}
                className="ml-2 h-9 rounded-md border bg-background px-2"
                value={e.hour}
                onChange={(event) => e.setHour(Number(event.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {drawerOpen && (
          <section
            className="space-y-2 border-t pt-3"
            aria-label={l("候选预览", "Candidate preview")}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {l("候选，尚未 AI 精筛", "Candidates; not AI screened")}
              </h3>
              <Button
                size="icon"
                variant="ghost"
                aria-label={l("关闭预览", "Close preview")}
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {e.preview?.issues.map((issue, i) => (
              <p key={i} role="alert" className="text-sm text-destructive">
                {issueLabel(issue, zh)}
              </p>
            ))}
            {e.preview?.candidates.map((repo) => (
              <div key={repo.id} className="border-b py-2">
                <a
                  href={repo.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm font-medium hover:underline"
                >
                  {repo.full_name}
                </a>
                <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                  {repo.description}
                </p>
              </div>
            ))}
            {e.preview && !e.preview.candidates.length && (
              <p className="text-sm text-muted-foreground">
                {e.preview.complete
                  ? l("暂无候选", "No candidates")
                  : l(
                      "预览未完成，可重试",
                      "Preview incomplete; retry available",
                    )}
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
