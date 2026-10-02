import { Loader2, RefreshCw, Square, Zap } from 'lucide-react';
import type { TranslateFn } from '../../i18n/useT';
import type { VectorIndexingState } from '../../types';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { VectorPendingBadge } from './VectorPendingBadge';

interface VectorIndexOperationsPanelProps {
  t: TranslateFn;
  state: VectorIndexingState;
  configComplete: boolean;
  settingsSaved: boolean;
  compatibleIndex: boolean;
  candidateCount: number;
  localPendingCount: number;
  onRebuild: () => Promise<void>;
  onIncremental: () => Promise<void>;
  onAbort: () => void;
}

export function VectorIndexOperationsPanel({
  t, state, configComplete, settingsSaved, compatibleIndex, candidateCount,
  localPendingCount, onRebuild, onIncremental, onAbort,
}: VectorIndexOperationsPanelProps) {
  const { isIndexing, phase, phaseDone, phaseTotal, result } = state;
  const progress = phaseTotal > 0 ? Math.max(0, Math.min(100, Math.round(phaseDone / phaseTotal * 100))) : 0;
  const phaseKey = phase === 'readme' ? 'fetching-readme'
    : phase === 'embedding' ? 'generating-embeddings'
      : phase === 'uploading' ? 'uploading-vectors' : 'preparing';
  return (
    <section aria-labelledby="vector-index-operations-title" className="space-y-4 border-b border-border pb-6">
      <h3 id="vector-index-operations-title" className="flex items-center gap-2 font-medium">
        <Zap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t('vectorSearchSettings.index-management')}
        <VectorPendingBadge count={localPendingCount} t={t} />
      </h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt>{t('vectorSearchSettings.local-pending', { defaultValue: 'Locally known pending' })}</dt>
          <dd className="tabular-nums">{localPendingCount}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t('vectorSearchSettings.scan-candidates', { defaultValue: 'Incremental scan candidates' })}</dt>
          <dd className="tabular-nums">{candidateCount}</dd>
        </div>
      </dl>
      {!compatibleIndex && (
        <Alert><AlertDescription>{t('vectorSearchSettings.must-rebuild-index-after-changing-embedding-mode')}</AlertDescription></Alert>
      )}
      {!settingsSaved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('vectorSearchSettings.save-before-indexing', { defaultValue: 'Unsaved embedding or index settings' })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" onClick={() => { void onRebuild(); }} disabled={isIndexing || !configComplete || !settingsSaved}>
          {isIndexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('vectorSearchSettings.rebuild-vector-index')}
        </Button>
        <Button
          variant="secondary"
          className="h-auto min-h-9 max-w-full whitespace-normal"
          onClick={() => { void onIncremental(); }}
          disabled={isIndexing || !configComplete || !settingsSaved || !compatibleIndex || candidateCount === 0}
        >
          {isIndexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('vectorSearchSettings.incremental-index')}
        </Button>
        {isIndexing && (
          <Button variant="destructive" className="h-auto min-h-9 max-w-full whitespace-normal" onClick={onAbort}>
            <Square className="h-4 w-4" />{t('vectorSearchSettings.abort')}
          </Button>
        )}
      </div>
      {isIndexing && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
            <span>{t(`vectorSearchSettings.${phaseKey}`)}</span>
            {phaseTotal > 0 && <span className="tabular-nums">{phaseDone}/{phaseTotal} ({progress}%)</span>}
          </div>
          {phaseTotal > 0 && (
            <div
              role="progressbar" aria-label={t(`vectorSearchSettings.${phaseKey}`)}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
              className="h-2 w-full overflow-hidden rounded-full bg-accent"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
      {result && (
        <Alert variant={result.errors > 0 ? 'destructive' : 'default'}>
          <AlertDescription>
            {t('vectorSearchSettings.indexing-complete')}: {result.indexed} {t('vectorSearchSettings.indexed')},
            {' '}{result.skipped} {t('vectorSearchSettings.skipped')}, {result.errors} {t('vectorSearchSettings.errors')}
            {result.error && <div className="mt-1 text-xs">{result.error}</div>}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
