import { useEffect, useState, useSyncExternalStore } from 'react';
import { agyQueueStatus } from '../../../services/agyClient';
import type { RepositoryChatMessage, ToolEvidence } from '../../../types/repositoryChat';
import type { WorkbenchTaskState } from '../../../types/aiWorkbench';
import { useT } from '../../../i18n/useT';

export function ResearchTimer({ task }: { task: WorkbenchTaskState }) {
  const t = useT('chat');
  const position = useSyncExternalStore(agyQueueStatus.subscribe, agyQueueStatus.snapshot);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!task.running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.running]);
  return <span className="shrink-0 text-xs text-muted-foreground">
    {Math.max(0, Math.floor((now - (task.startedAt ?? now)) / 1000))}s · {t('research.readFiles', { count: task.readFiles ?? 0 })}
    {Number.isFinite(position) && <span> · {t('research.pending')} #{position}</span>}
  </span>;
}

export function ResearchStatus({ message, evidence }: { message: RepositoryChatMessage; evidence: ToolEvidence[] }) {
  const t = useT('chat');
  if (!message.researchSources?.length) return null;
  const criteria = [...new Set(message.comparison?.map(cell => cell.requirement))];
  return <div className="mt-3 max-w-full overflow-x-auto">
    <table className="w-full text-left text-xs">
      <caption className="pb-2 text-left font-medium">{t('research.sources')}</caption>
      <thead><tr><th className="py-2 pr-3">{t('workbench.repositories')}</th><th className="py-2">{t('research.state')}</th>
        {criteria.map(criterion => <th key={criterion} className="min-w-28 p-2">{criterion}</th>)}</tr></thead>
      <tbody>{message.researchSources.map(source => <tr key={source.repository} className="border-t border-border">
        <td className="max-w-64 break-words py-2 pr-3">{source.repository}
          {source.version && <div className="break-all text-muted-foreground">{source.version.slice(0, 12)}</div>}</td>
        <td className="py-2">{t(`research.${source.status}`)}
          {evidence.filter(item => source.evidenceIds.includes(item.id)).slice(0, 1).map(item =>
            item.source === 'local' ? <div key={item.id}>{item.path}</div> :
              /^https:\/\/github\.com\//.test(item.url) && <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                className="block text-primary underline">{item.path ?? t('workbench.evidence')}</a>)}
        </td>
        {criteria.map(criterion => {
          const cell = message.comparison?.find(item => item.repository === source.repository && item.requirement === criterion);
          const cited = evidence.find(item => item.id === cell?.evidenceId);
          return <td key={criterion} className="p-2 align-top">
            {t(cell?.status === 'supported' ? 'research.supported' : cell?.status === 'unsupported' ? 'research.unsupported' : 'research.unknown')}
            {cell?.quote && <details className="mt-1"><summary className="cursor-pointer">{t('workbench.evidence')}</summary>
              <blockquote className="max-w-72 whitespace-pre-wrap">{cell.quote}</blockquote>
              {cited?.source !== 'local' && cited && /^https:\/\/github\.com\//.test(cited.url)
                ? <a href={cited.url} target="_blank" rel="noreferrer" className="text-primary underline">{cited.path}</a> : cited?.path}
            </details>}
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
