import { useState } from 'react';
import { useT } from '../i18n/useT';
import { useBatchStarImport } from '../features/repositories/hooks/useBatchStarImport';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { Modal } from './Modal';
import { PageTranslationButton } from './PageTranslationButton';

interface BatchStarImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dialog for starring repositories parsed from pasted text: previews their
 * details and stars the user's selection with per-repository results.
 * Translation belongs to the independent whole-page lifecycle.
 */
export function BatchStarImportDialog({ isOpen, onClose }: BatchStarImportDialogProps) {
  const t = useT('repositories');
  const [text, setText] = useState('');
  const {
    rows, duplicateCount, inputError, isResolving, isStarring, syncError,
    preview, toggleRow, selectAll, invertSelection, clearPreview, starSelected,
  } = useBatchStarImport();
  const selectedCount = rows.filter(row => row.status === 'ready' && row.selected).length;
  const starredCount = rows.filter(row => row.status === 'starred').length;
  // Keep partial batches open; page translation never locks business actions.
  const locked = isResolving || isStarring;
  const busy = locked;
  const hasSelectable = rows.some(row => row.status === 'ready');

  const errorLabels: Record<string, string> = {
    'sign-in': t('batchStar.sign-in'),
    'no-repositories': t('batchStar.no-repositories'),
    'too-many-repositories': t('batchStar.too-many-repositories'),
    'input-too-large': t('batchStar.input-too-large'),
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!locked) onClose(); }}
      title={t('batchStar.title')}
      maxWidth="max-w-3xl"
      scrollable
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {starredCount > 0 ? t('batchStar.completed', { count: starredCount }) : t('batchStar.selected', { count: selectedCount })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={locked} onClick={onClose}>{t('batchStar.close')}</Button>
            <Button disabled={busy || selectedCount === 0} onClick={() => void starSelected()}>
              {isStarring ? t('batchStar.starring') : t('batchStar.star-selected', { count: selectedCount })}
            </Button>
          </div>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('batchStar.hint')}</p>
      <Textarea
        aria-label={t('batchStar.input-label')}
        value={text}
        onChange={event => { setText(event.target.value); clearPreview(); }}
        disabled={busy}
        placeholder={t('batchStar.placeholder')}
        className="min-h-32 resize-y"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void preview(text)}>
          {isResolving ? t('batchStar.checking') : t('batchStar.preview')}
        </Button>
        {duplicateCount > 0 && <span className="text-sm text-muted-foreground">{t('batchStar.duplicates', { count: duplicateCount })}</span>}
      </div>
      {inputError && <p role="alert" className="mt-3 text-sm text-destructive">{errorLabels[inputError] ?? inputError}</p>}
      {syncError && <p role="alert" className="mt-3 text-sm text-destructive">{t('batchStar.sync-failed')}: {syncError}</p>}
      {rows.length > 0 && (
        <div className="mt-5 space-y-2" aria-label={t('batchStar.results')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy || !hasSelectable} onClick={selectAll}>
                {t('batchStar.select-all')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !hasSelectable} onClick={invertSelection}>
                {t('batchStar.invert-selection')}
              </Button>
            </div>
            <PageTranslationButton />
          </div>
          {rows.map((row, index) => {
            const renamed = row.detail && row.detail.full_name.toLowerCase() !== row.candidate.repositoryFullName.toLowerCase();
            const label = row.detail?.full_name ?? (row.candidate.repositoryFullName || row.candidate.originalValue);
            const statusKey = row.status === 'ready' && row.candidate.confidence === 'low'
              ? 'check-name'
              : row.status;
            // 已 Star（含本次批处理刚 Star 成功）的仓库固定为选中禁用态，
            // 与"无法再次 Star"的业务状态保持一致。
            const rowStarred = row.status === 'already-starred' || row.status === 'starred';
            const description = row.detail?.description || t('batchStar.no-description');
            return (
              <div key={`${row.candidate.originalValue}-${index}`} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={rowStarred ? true : row.selected}
                    disabled={busy || row.status !== 'ready'}
                    onCheckedChange={() => toggleRow(index)}
                    aria-label={t('batchStar.select-repository', { name: label })}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {row.detail ? (
                        <a href={row.detail.html_url} target="_blank" rel="noopener noreferrer" className="break-all font-medium hover:underline">
                          {renamed ? `${row.candidate.repositoryFullName} → ${label}` : label}
                        </a>
                      ) : <span className="break-all font-medium">{label}</span>}
                      <span className="text-xs text-muted-foreground">{t(`batchStar.${statusKey}`)}</span>
                    </div>
                    {row.detail && (
                      <>
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.detail.language || '—'} · ★ {row.detail.stargazers_count.toLocaleString()}</p>
                      </>
                    )}
                    {row.error && <p className="mt-1 break-all text-xs text-destructive">{row.error}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
