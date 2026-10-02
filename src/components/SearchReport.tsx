import { useT } from '../i18n/useT';
import type { SearchActions } from '../features/repositories/hooks/useSearchActions';

export function SearchReport({ report }: { report: NonNullable<SearchActions['searchReport']> }) {
  const t = useT('chat');
  return <div role="status" className="mt-2 space-y-1 text-xs text-muted-foreground">
    <p>{t('research.searchSummary', { mode: t(`research.${report.mode}`), total: report.total, count: report.count })}</p>
    {report.fallback && <p>{t('research.fallback')}: {report.fallback === 'rerank-unavailable'
      ? t('research.rerankUnavailable') : report.fallback === 'vector-unavailable'
        ? t('research.vectorUnavailable') : report.fallback}</p>}
  </div>;
}
