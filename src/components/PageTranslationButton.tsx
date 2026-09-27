import { Languages, Loader2, RotateCcw } from 'lucide-react';
import { usePageTranslation } from '../hooks/usePageTranslation';
import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function PageTranslationButton() {
  const { enabled, setEnabled, status, retry } = usePageTranslation();
  const t = useT('app');
  const label = enabled ? t('pageTranslation.original') : t('pageTranslation.enable');
  return (
    <div className="flex shrink-0 items-center" translate="no">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant={enabled ? 'secondary' : 'ghost'} size="icon"
            aria-label={label} aria-pressed={Boolean(enabled)} onClick={() => setEnabled(!enabled)}>
            {status === 'translating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent translate="no">{status === 'translating' ? t('pageTranslation.translating') : label}</TooltipContent>
      </Tooltip>
      {enabled && status === 'error' && (
        <Button type="button" variant="ghost" size="icon" onClick={retry}
          aria-label={t('pageTranslation.retry')} title={t('pageTranslation.retry')}>
          <RotateCcw className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
