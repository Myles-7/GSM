import { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Check, ExternalLink, MoreHorizontal, NotebookPen, Star } from 'lucide-react';
import type { ReadingProjectItem } from '../../features/settings/hooks/useReadingProjects';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import MarkdownRenderer from '../MarkdownRenderer';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../ui/dropdown-menu';

const folded = new Set(['architecture', 'quickstart', 'deployment', 'cost', 'maintenance']);
export function ReadingProjectDetail({ item, busy, draft, onNotes, onAction, onRefreshStar, narrow, onBack, scroll = 0, onScroll, expanded = [], onExpanded, className = '' }: {
  item?: ReadingProjectItem; busy: boolean; draft?: string; onNotes: () => void; onAction: (command: string) => void; onRefreshStar: (id: string) => void;
  narrow: boolean; onBack: () => void; scroll?: number; onScroll: (value: number) => void; expanded?: string[]; onExpanded: (value: string[]) => void; className?: string;
}) {
  const t = useT('settings');
  const language = useAppStore(state => state.language);
  const body = useRef<HTMLDivElement>(null);
  const itemId = item?.id;
  const initialScroll = useRef(scroll); initialScroll.current = scroll;
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = initialScroll.current; }, [itemId]);
  const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US'); };
  if (!item) return <section className={`reading-detail-card items-center justify-center p-6 text-sm text-muted-foreground ${className}`}>{t('dailyProjects.chooseProject')}</section>;
  const [owner, ...names] = item.name.split('/');
  const analysis = item.analysis.filter(block => block.text.trim() && block.text.trim() !== item.summary.trim());
  const commands = ['read', 'unread', 'interested', 'ignored', 'neutral', 'candidate', 'uncandidate'];
  return <section aria-label={t('dailyProjects.projectDetail')} className={`reading-detail-card ${className}`}>
    <header className="reading-detail-head"><div className="min-w-0">{narrow && <Button size="sm" variant="ghost" className="mb-2 -ml-2" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4"/>{t('readingClean.backToProjects')}</Button>}<h2>{names.join('/') || item.name}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{owner}</p><div className="reading-detail-meta"><span><Star className="h-3.5 w-3.5" fill={item.starState === 'starred' ? 'currentColor' : 'none'}/>{t(`dailyProjects.star.${item.starState}`)}</span>{item.state.interest !== 'neutral' && <span>{t(`dailyProjects.interest.${item.state.interest}`)}</span>}{item.state.candidate && <span>{t('dailyProjects.candidate')}</span>}{item.state.read && <span><Check className="h-3 w-3"/>{t('dailyProjects.read.read')}</span>}</div></div>
      <div className="reading-detail-tools"><Button size="icon" variant="ghost" aria-label={t('dailyProjects.noteTitle')} title={t('dailyProjects.noteTitle')} onClick={onNotes}><NotebookPen className={`h-4 w-4 ${draft !== undefined && draft !== item.state.note ? 'text-primary' : ''}`}/>{(item.state.note || draft) && <span className="h-1 w-1 rounded-full bg-primary"/>}</Button><a href={`https://github.com/${item.name}`} target="_blank" rel="noopener noreferrer" aria-label={t('readingClean.openGithub')} title={t('readingClean.openGithub')} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"><ExternalLink className="h-4 w-4"/></a></div>
    </header>
    <div ref={body} className="reading-detail-body" onScroll={event => onScroll(event.currentTarget.scrollTop)}><div>
      {item.summary && <section><h3 className="text-muted-foreground">{t('dailyProjects.summary')}</h3><MarkdownRenderer content={item.summary} className="reading-prose"/></section>}
      {analysis.map((block, index) => {
        const key = block.key || `legacy-${index}`;
        const content = <MarkdownRenderer content={block.text} className="reading-prose"/>;
        return folded.has(key) ? <details key={key} open={expanded.includes(key)} onToggle={event => { const open = event.currentTarget.open; if (open !== expanded.includes(key)) onExpanded(open ? [...expanded, key] : expanded.filter(value => value !== key)); }}><summary>{block.title}</summary>{expanded.includes(key) && content}</details> : <section key={key}><h3>{block.title}</h3>{content}</section>;
      })}
      {!item.summary && !analysis.length && <p className="text-sm text-muted-foreground">{t('dailyProjects.noSummary')}</p>}
      <details className="text-xs text-muted-foreground"><summary>{t('dailyProjects.sourceDetails')}</summary><p className="break-words">{item.name}</p><p className="mt-2 break-words">{item.source ? t('dailyProjects.source', { file: item.source.fileName || t('dailyProjects.unknownSource'), time: time(item.source.importedAt) }) : t('dailyProjects.unknownSource')}</p><p className="mt-2">{item.starCheckedAt ? t('dailyProjects.checkedAt', { time: time(item.starCheckedAt) }) : t('dailyProjects.noCheckTime')}</p>{item.processedReason && <p className="mt-2">{t(`dailyProjects.processedReason.${item.processedReason}`)}</p>}</details>
    </div></div>
    <footer className="reading-detail-footer"><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={t('readingClean.moreActions')}><MoreHorizontal className="mr-1 h-4 w-4"/>{t('readingClean.moreActions')}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{commands.map(command => <DropdownMenuItem key={command} disabled={busy} onSelect={() => onAction(command)}>{t(`dailyProjects.actions.${command}`)}</DropdownMenuItem>)}<DropdownMenuSeparator/><DropdownMenuItem disabled={busy} onSelect={() => onRefreshStar(item.id)}>{t('dailyProjects.refreshOne')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(item.processed ? 'restore' : 'process')}><Check className="mr-1 h-4 w-4"/>{t(`dailyProjects.actions.${item.processed ? 'restore' : 'process'}`)}</Button></footer>
  </section>;
}
