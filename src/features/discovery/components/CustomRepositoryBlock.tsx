import { useState } from 'react';
import { AlertCircle, ArrowRight, BookOpen, Calendar, Check, ChevronDown, ExternalLink, EyeOff, Loader2, MessageSquareText, MoreHorizontal, Sparkles, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Repository } from '../../../types';
import { getDateFnsLocale } from '../../../i18n/format';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/button';
import { ReadmeModal } from '../../../components/ReadmeModal';
import { RepositoryLanguageStars, RepositorySoftwareForms, repositoryListDescriptionClass, repositoryListSurfaceClass } from '../../../components/RepositoryListPresentation';
import { getPlatformDisplayName } from '../../../components/platformMeta';
import { readRepositoryDetails } from '../../../utils/repositoryDetailsSchema';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import type { CandidateAssessment, CustomDiscoveryChannel } from '../custom/model';
import { useCustomChannelActions } from '../hooks/useCustomChannelActions';
import { reportCustomError, updateCustomData, useCustomDiscovery } from '../custom/store';
import { analysisKey, useCustomAnalysis } from '../custom/analysis';
import { issueLabel, taskIssue } from '../custom/taskStatus';

export function CustomRepositoryBlock({
  item, repo, channel, active, selected, onSelect, onDetails, onAsk, onAnalyze, onApprove, onBlock
}: {
  item: CandidateAssessment; repo: Repository; channel: CustomDiscoveryChannel; active: boolean; selected: boolean;
  onSelect: () => void; onDetails: () => void; onAsk: () => void; onAnalyze: () => void;
  onApprove?: () => void; onBlock?: () => void;
}) {
  const language = useAppStore(s => s.language);
  const config = useAppStore(s => s.aiConfigs.find(c => c.id === s.activeAIConfig));
  const zh = language.startsWith('zh');
  const l = (cn: string, en: string) => zh ? cn : en;
  const [readme, setReadme] = useState(false);
  const [starring, setStarring] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [error, setError] = useState('');
  const actions = useCustomChannelActions();
  const starred = useAppStore(s => s.repositories.some(r => r.id === repo.id));
  const others = useCustomDiscovery(s => s.data.channels.filter(c => c.id !== channel.id && c.recommended[String(repo.id)]).map(c => c.name));
  const key = analysisKey(repo, language, config);
  const task = useCustomAnalysis(s => s.items.find(i => i.key === key && i.channelId === channel.id));
  const record = useCustomDiscovery(s => s.data.analyses?.[key]);
  const cachedReadme = useCustomDiscovery(s => s.data.cache[String(repo.id)]);
  const details = readRepositoryDetails(repo.ai_details);
  const read = channel.read.includes(repo.id);
  const state = task?.status === 'done' ? record?.status || task.status : task?.status || record?.status;
  const stateText = state === 'queued' ? l('排队中', 'Queued') : state === 'running' ? l('分析中', 'Analyzing')
    : state === 'waiting' ? l('等待其他任务', 'Waiting for another task')
    : state === 'failed' ? l('分析失败', 'Analysis failed') : details ? l('已分析', 'Analyzed') : state === 'cancelled' ? l('已取消', 'Cancelled') : '';
  const patch = (field: 'read' | 'blocked') => {
    void updateCustomData(data => {
      const c = data.channels.find(x => x.id === channel.id);
      if (!c) return;
      c[field] = c[field].includes(repo.id) ? c[field].filter(id => id !== repo.id) : [...c[field], repo.id];
    }).catch(reportCustomError);
  };
  const star = async () => {
    setStarring(true); setError('');
    try { await actions.star(repo); }
    catch (error) { setError(issueLabel(taskIssue(error), zh)); }
    finally { setStarring(false); }
  };
  const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('button,a,input,summary,details');
  const date = Date.parse(repo.pushed_at || repo.updated_at);
  return <article className={`${repositoryListSurfaceClass} min-w-0 rounded-md ${active ? 'outline outline-2 outline-offset-2 outline-primary' : ''} ${selected ? 'linear-card-selected' : ''}`}
    tabIndex={0} aria-label={repo.full_name} data-testid="custom-repository-block"
    onClick={event => { if (!interactive(event.target)) onDetails(); }}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onDetails(); } }}>
    <div className="mb-3 flex flex-wrap items-start gap-3">
      {!avatarFailed && repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt="" onError={() => setAvatarFailed(true)} className="h-10 w-10 shrink-0 rounded-full" />
        : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{repo.owner.login.slice(0, 2).toUpperCase()}</span>}
      <div className="min-w-0 flex-1 basis-28"><h3 className="break-all text-base font-semibold">{repo.name}</h3><p className="break-all text-sm text-muted-foreground">{repo.owner.login}</p></div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {stateText && <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground" role={state === 'running' ? 'status' : undefined}>
          {state === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{stateText}
        </span>}
        <Button
          variant="ghost"
          size="icon"
          disabled={starring}
          onClick={() => void star()}
          title={starred ? l('已 Star', 'Starred') : 'Star'}
          aria-label={starred ? l('已 Star', 'Starred') : 'Star'}
          className={starred ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-foreground'}
        >
          {starring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={`h-4 w-4 ${starred ? 'fill-current text-amber-500' : ''}`} />}
        </Button>
        <Button variant="ghost" size="icon" title={l('问答此仓库', 'Ask this repository')} aria-label={l('问答此仓库', 'Ask this repository')} onClick={onAsk}><MessageSquareText className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" asChild><a href={repo.html_url} target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub"><ExternalLink className="h-4 w-4" /></a></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={l('项目操作', 'Project actions')} title={l('项目操作', 'Project actions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setReadme(true)}><BookOpen className="mr-2 h-4 w-4" />README</DropdownMenuItem>
            <DropdownMenuItem onSelect={onAnalyze} disabled={state === 'running' || state === 'queued' || state === 'waiting'}><Sparkles className="mr-2 h-4 w-4" />{details ? l('重新分析', 'Analyze again') : l('AI 分析', 'AI analysis')}</DropdownMenuItem>
            <DropdownMenuItem disabled={starred || starring} onSelect={() => void star()}><Star className="mr-2 h-4 w-4" />{starred ? l('已 Star', 'Starred') : 'Star'}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch('read')}><Check className="mr-2 h-4 w-4" />{read ? l('标为未读', 'Mark unread') : l('标为已读', 'Mark read')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => patch('blocked')}><EyeOff className="mr-2 h-4 w-4" />{l('不再推荐', 'Do not recommend')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <p className={`${repositoryListDescriptionClass} mb-3`}>{repo.ai_summary || repo.description || l('暂无描述', 'No description')}</p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <RepositorySoftwareForms forms={[...new Set(details?.software_forms || [])].slice(0, 2)} />
      <RepositoryLanguageStars language={repo.language} stars={repo.stargazers_count} />
      {!!repo.ai_platforms?.length && <span className="break-words text-xs text-muted-foreground">{repo.ai_platforms.map(getPlatformDisplayName).join(' · ')}</span>}
    </div>
    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {item.screening ? <span>{l('规则核实中', 'Checking rules')}</span> : item.verdict === 'unknown' && <span>{l('待核实', 'Unverified')}</span>}
        {read && <span>{l('已读', 'Read')}</span>}{starred && <span>{l('已 Star', 'Starred')}</span>}
        {!!others.length && <span className="break-words">{l('其他频道已推荐', 'Also recommended in')}: {others.join(', ')}</span>}
      </div>
      {item.reason && (
        <div className="rounded-md bg-accent/40 dark:bg-accent/25 border border-accent/60 px-2.5 py-1.5 text-xs text-foreground/90 flex items-start gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <span className="break-words leading-relaxed">
            <strong className="font-medium text-foreground">{l('命中原因', 'Match reason')}: </strong>
            {item.reason}
          </span>
        </div>
      )}
      {record?.updatedAt && <p>{l('分析缓存时间', 'Analysis cached at')}: <time dateTime={new Date(record.updatedAt).toISOString()}>{new Date(record.updatedAt).toLocaleString()}</time></p>}
      {cachedReadme?.fetchedAt && <p>{l('README 缓存时间', 'README cached at')}: <time dateTime={new Date(cachedReadme.fetchedAt).toISOString()}>{new Date(cachedReadme.fetchedAt).toLocaleString()}</time>
        {cachedReadme.pushedAt !== (repo.pushed_at || repo.updated_at) && <span> · {l('来源已更新，需重新读取', 'Source updated; refresh required')}</span>}</p>}
      {!!item.evidence.length && (
        <details className="group rounded-md bg-muted/40 dark:bg-muted/15 border border-border/50 text-xs">
          <summary className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 font-medium text-muted-foreground hover:text-foreground select-none">
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{l('判断证据', 'Evidence')}</span>
              <span className="text-xs opacity-75">({item.evidence.length})</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 border-t border-border/30">
            {item.evidence.map((quote, index) => (
              <blockquote key={index} className="rounded bg-background/60 p-2 text-xs text-muted-foreground border-l-2 border-primary/60 italic leading-relaxed whitespace-pre-wrap break-words">
                {quote}
              </blockquote>
            ))}
          </div>
        </details>
      )}
      {item.verdict === 'unknown' && onApprove && onBlock && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-xs mt-2">
          <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {l('规则核实建议：此项目待人工确认', 'Unverified: requires user confirmation')}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={onBlock}
            >
              <EyeOff className="mr-1 h-3.5 w-3.5" />
              {l('排除不再推', 'Block / Dismiss')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onApprove}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {l('采纳并推荐', 'Approve')}
            </Button>
          </div>
        </div>
      )}
      {(task?.issue || record?.issue) && <p className="text-destructive">{issueLabel((task?.issue || record?.issue)!, zh)}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
    <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
      {Number.isFinite(date) && <span className="flex min-w-0 flex-1 items-center gap-1.5"><Calendar className="h-4 w-4 shrink-0" /><span className="truncate">{l('最近提交', 'Last pushed')} {formatDistanceToNow(date, { addSuffix: true, locale: getDateFnsLocale(language) })}</span></span>}
      <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={onDetails}>{l('详情', 'Details')}<ArrowRight className="h-3 w-3" /></Button>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`${l('选择', 'Select')} ${repo.full_name}`} className="h-4 w-4 shrink-0 accent-primary cursor-pointer" />
    </div>
    {readme && <ReadmeModal isOpen onClose={() => setReadme(false)} repository={repo} />}
  </article>;
}
