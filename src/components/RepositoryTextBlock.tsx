import { useState, type ReactNode } from "react";
import { ArrowRight, Calendar, GitFork, Scale } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Repository } from "../types";
import { useAppStore } from "../store/useAppStore";
import { getDateFnsLocale } from "../i18n/format";
import { readRepositoryDetails } from "../utils/repositoryDetailsSchema";
import { getPlatformDisplayName } from "./platformMeta";
import {
  RepositoryLanguageStars,
  RepositorySoftwareForms,
  repositoryListDescriptionClass,
  repositoryListSurfaceClass,
} from "./RepositoryListPresentation";
import { Button } from "./ui/button";
import { RepositoryAnalysisFreshness } from './RepositoryAnalysisFreshness';
import { applyRepositoryAnalysisAsset, useRepositoryAnalysisAssets } from '../services/repositoryAnalysisAssets';

interface Props {
  repo: Repository;
  onDetails: () => void;
  actions: ReactNode;
  children?: ReactNode;
  status?: ReactNode;
  active?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  testId?: string;
}
export function RepositoryTextBlock({
  repo,
  onDetails,
  actions,
  children,
  status,
  active,
  selected,
  onSelect,
  testId,
}: Props) {
  const language = useAppStore((s) => s.language);
  const account = useAppStore((s) => s.user?.id);
  useRepositoryAnalysisAssets((s) => s.assets);
  if (account !== undefined) repo = applyRepositoryAnalysisAsset(String(account), repo, language);
  const zh = language.startsWith("zh");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const details = readRepositoryDetails(repo.ai_details);
  const date = Date.parse(repo.pushed_at || repo.updated_at);
  const license =
    typeof repo.license === "string"
      ? repo.license
      : (repo.license as { spdx_id?: string } | null)?.spdx_id;
  return (
    <article
      aria-label={repo.full_name}
      tabIndex={0}
      data-testid={testId}
      className={`${repositoryListSurfaceClass} min-w-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? "outline outline-2 outline-offset-2 outline-primary" : ""} ${selected ? "linear-card-selected" : ""}`}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button,a,input,label,summary,details")
        )
          return;
        if (window.getSelection()?.toString()) return;
        onDetails();
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onDetails();
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {!avatarFailed && repo.owner.avatar_url ? (
          <img
            src={repo.owner.avatar_url}
            alt=""
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            className="h-10 w-10 shrink-0 rounded-full"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {repo.owner.login.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1 basis-28">
          <h3 className="break-all text-base font-semibold">{repo.name}</h3>
          <p className="break-all text-sm text-muted-foreground">
            {repo.owner.login}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <RepositoryAnalysisFreshness repository={repo} />
          {status}
          {actions}
        </div>
      </div>
      <p className={`${repositoryListDescriptionClass} mb-3`}>
        {repo.ai_summary ||
          repo.description ||
          (zh ? "暂无描述" : "No description")}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <RepositorySoftwareForms
          forms={[...new Set(details?.software_forms || [])].slice(0, 2)}
        />
        <RepositoryLanguageStars
          language={repo.language}
          stars={repo.stargazers_count}
        />
        {repo.forks_count !== undefined && (
          <span className="inline-flex items-center gap-1">
            <GitFork className="h-3.5 w-3.5" />
            {repo.forks_count.toLocaleString()}
          </span>
        )}
        {license && license !== "NOASSERTION" && (
          <span className="inline-flex items-center gap-1">
            <Scale className="h-3.5 w-3.5" />
            {license}
          </span>
        )}
        {!!repo.ai_platforms?.length && (
          <span className="break-words">
            {repo.ai_platforms.map(getPlatformDisplayName).join(" · ")}
          </span>
        )}
      </div>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        {Number.isFinite(date) && (
          <span className="flex min-w-0 flex-1 basis-32 items-center gap-1.5">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="break-words">
              {zh ? "最近提交" : "Last pushed"}{" "}
              {formatDistanceToNow(date, {
                addSuffix: true,
                locale: getDateFnsLocale(language),
              })}
            </span>
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2.5 text-xs"
          onClick={onDetails}
        >
          {zh ? "详情" : "Details"}
          <ArrowRight className="h-3 w-3" />
        </Button>
        {onSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onSelect}
            aria-label={`${zh ? "选择" : "Select"} ${repo.full_name}`}
            className="h-4 w-4 shrink-0 accent-primary"
          />
        )}
      </div>
    </article>
  );
}

export function RepositoryTextSkeletons() {
  return (
    <div
      role="status"
      aria-label="Loading repositories"
      className="space-y-4"
      aria-busy="true"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={`${repositoryListSurfaceClass} space-y-3 rounded-md`}
        >
          <div className="flex gap-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
