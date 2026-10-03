import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import type {
  DiscoveryChannelId,
  DiscoveryRepo,
  Repository,
} from "../../../types";
import { useAppStore } from "../../../store/useAppStore";
import { SubscriptionRepoCard } from "../../../components/SubscriptionRepoCard";
import { RepositoryDetailsPanel } from "../../../components/RepositoryDetailsPanel";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/Modal";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import {
  useCustomDiscovery,
} from "../custom/store";
import {
  analysisKey,
  analyzedRepository,
  cancelAnalysis,
  enqueueAnalysis,
  setAnalysisPaused,
  useCustomAnalysis,
} from "../custom/analysis";
import { issueLabel } from "../custom/taskStatus";
import { discoveryItemKey } from '../workspace/model';
import { useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';

const Chat = lazy(() => import("../../../components/RepositoryChatSheet"));
export function BuiltinRepositoryResults({
  items,
  channelId,
  desktopSafeMode,
}: {
  items: DiscoveryRepo[];
  channelId: DiscoveryChannelId;
  desktopSafeMode?: boolean;
}) {
  const language = useAppStore((s) => s.language);
  const config = useAppStore((s) =>
    s.aiConfigs.find((c) => c.id === s.activeAIConfig),
  );
  const zh = language.startsWith("zh");
  const l = (cn: string, en: string) => (zh ? cn : en);
  const data = useCustomDiscovery((s) => s.data);
  const analysis = useCustomAnalysis();
  useRepositoryAnalysisAssets(s => s.assets);
  const scope = { id: `builtin:${channelId}`, revision: 1 };
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Repository[] | null>(null);
  const repos = items.map((repo) => ({
    ...repo,
    ...analyzedRepository(repo, data, language, config),
  }));
  const index = repos.findIndex((r) => r.id === activeId);
  const chat = repos.find((r) => r.id === chatId);
  const tasks = analysis.items.filter((task) => task.channelId === scope.id);
  const running = tasks.some((task) =>
    ["queued", "waiting", "running"].includes(task.status),
  );
  const paused = !!analysis.pausedChannels[scope.id];
  const unanalyzed = repos.filter(
    (repo) => !repo.ai_details,
  );
  const request = (targets: Repository[]) => {
    if (
      targets.some(
        (repo) => !!repo.ai_details,
      )
    )
      setConfirm(targets);
    else enqueueAnalysis(scope, targets);
  };
  const selectedRepos = repos.filter((r) => selected.has(r.id));
  const failed = tasks.filter(
    (task) =>
      task.status === "failed" && repos.some((r) => r.id === task.repo.id),
  );
  const issue = failed[0]?.issue ?? analysis.issuesByChannel[scope.id];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label={l("选择当前列表", "Select current list")}
            checked={repos.length > 0 && selectedRepos.length === repos.length}
            onChange={(e) =>
              setSelected(
                e.target.checked ? new Set(repos.map((r) => r.id)) : new Set(),
              )
            }
          />
          {selectedRepos.length}/{repos.length}
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={running || !unanalyzed.length}
          onClick={() => enqueueAnalysis(scope, unanalyzed)}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {l("分析未分析项", "Analyze remaining")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={running || !selectedRepos.length}
          onClick={() => request(selectedRepos)}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {l("分析所选", "Analyze selected")}
        </Button>
        {running && (
          <>
            <span role="status" className="text-xs text-muted-foreground">
              {
                tasks.filter((t) =>
                  ["done", "failed", "cancelled"].includes(t.status),
                ).length
              }
              /{tasks.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                paused
                  ? l("继续分析", "Resume analysis")
                  : l("暂停分析", "Pause analysis")
              }
              title={
                paused
                  ? l("继续分析", "Resume analysis")
                  : l("暂停分析", "Pause analysis")
              }
              onClick={() => setAnalysisPaused(scope.id, !paused)}
            >
              {paused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={l("取消分析", "Cancel analysis")}
              aria-label={l("取消分析", "Cancel analysis")}
              onClick={() => cancelAnalysis(scope.id)}
            >
              <Square className="h-4 w-4" />
            </Button>
          </>
        )}
        {!!failed.length && !running && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              enqueueAnalysis(
                scope,
                failed.map((t) => t.repo),
                { force: true },
              )
            }
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            {l("重试失败项", "Retry failed")}
          </Button>
        )}
      </div>
      {issue && (
        <div role="alert" className="text-sm text-destructive">
          {issueLabel(issue, zh)}
          {issue.kind === "auth" && (
            <Button
              variant="link"
              onClick={() => useAppStore.getState().setCurrentView("settings")}
            >
              {l("配置 AI", "Configure AI")}
            </Button>
          )}
        </div>
      )}
      <div
        className="relative flex min-w-0 items-start gap-4"
        data-testid="builtin-results-layout"
      >
        <div className="min-w-0 flex-1 space-y-4">
          {repos.map((repo, i) => {
            const task = tasks.find(
              (t) => t.key === analysisKey(repo, language, config),
            );
            const status =
              task?.status === "running"
                ? l("分析中", "Analyzing")
                : task?.status === "queued"
                  ? l("排队中", "Queued")
                  : task?.status === "failed"
                    ? l("分析失败", "Analysis failed")
                    : repo.ai_details
                      ? l("已分析", "Analyzed")
                      : "";
            return (
              <div key={discoveryItemKey(repo)} data-repo-index={i} data-reading-key={discoveryItemKey(repo)}>
                <SubscriptionRepoCard
                  repo={repo}
                  desktopSafeMode={desktopSafeMode}
                  active={repo.id === activeId}
                  selected={selected.has(repo.id)}
                  onDetails={() => setActiveId(repo.id)}
                  onAsk={() => setChatId(repo.id)}
                  onRequestAnalysis={() => request([repo])}
                  analysisStatus={
                    status && (
                      <span
                        className="text-xs text-muted-foreground"
                        role="status"
                      >
                        {status}
                      </span>
                    )
                  }
                  onSelect={() =>
                    setSelected((before) => {
                      const next = new Set(before);
                      if (next.has(repo.id)) next.delete(repo.id);
                      else next.add(repo.id);
                      return next;
                    })
                  }
                />
              </div>
            );
          })}
        </div>
        <RepositoryDetailsPanel
          repository={repos[index] ?? null}
          onClose={() => setActiveId(null)}
          defaultDocked
          onAskRepository={(repo) => setChatId(repo.id)}
          analysisStatus={{
            running: tasks.some(
              (t) =>
                t.repo.id === activeId &&
                ["queued", "waiting", "running"].includes(t.status),
            ),
            stage: tasks.find((t) => t.repo.id === activeId)?.stage,
          }}
          onPrevious={
            index > 0 ? () => setActiveId(repos[index - 1].id) : undefined
          }
          onNext={
            index >= 0 && index < repos.length - 1
              ? () => setActiveId(repos[index + 1].id)
              : undefined
          }
          analysisAction={(repo) => (
            <Button
              variant="outline"
              size="sm"
              disabled={tasks.some(
                (t) =>
                  t.repo.id === repo.id &&
                  ["queued", "waiting", "running"].includes(t.status),
              )}
              onClick={() => request([repo])}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              {l("AI 分析", "AI analysis")}
            </Button>
          )}
        />
      </div>
      {chat &&
        createPortal(
          <ErrorBoundary>
            <Suspense
              fallback={
                <div
                  role="status"
                  className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
                >
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              }
            >
              <Chat isOpen repository={chat} onClose={() => setChatId(null)} />
            </Suspense>
          </ErrorBoundary>,
          document.body,
        )}
      {confirm && (
        <Modal
          isOpen
          onClose={() => setConfirm(null)}
          title={l("重新分析所选项目？", "Analyze again?")}
        >
          <p className="text-sm">
            {l(
              "成功后替换已有分析，失败时保留原内容。",
              "Success replaces the analysis; failure preserves existing content.",
            )}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {l("取消", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                enqueueAnalysis(scope, confirm, { force: true });
                setConfirm(null);
              }}
            >
              {l("开始分析", "Analyze")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
