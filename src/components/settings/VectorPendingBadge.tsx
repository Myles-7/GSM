import type { TranslateFn } from '../../i18n/useT';
import { formatLocalVectorPending } from '../../utils/localVectorPending';
import { Badge } from '../ui/badge';

export function VectorPendingBadge({ count, t }: { count: number; t: TranslateFn }) {
  if (count <= 0) return null;
  return (
    <Badge
      aria-label={t('vectorSearchSettings.local-pending-count', { count, defaultValue: '{{count}} locally known pending' })}
      title={t('vectorSearchSettings.local-pending-count', { count, defaultValue: '{{count}} locally known pending' })}
      className="ml-auto h-5 min-w-[1.25rem] shrink-0 justify-center px-1.5 text-[11px] tabular-nums"
    >
      {formatLocalVectorPending(count)}
    </Badge>
  );
}
