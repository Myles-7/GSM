import { Languages, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { usePageTranslation } from '../hooks/usePageTranslation';
import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { ConfirmDialog } from './ui/ConfirmDialog';

export function PageTranslationButton() {
  const { enabled, setEnabled, needsConsent, acceptConsent, status, retry } = usePageTranslation();
  const [consentOpen, setConsentOpen] = useState(false);
  const t = useT('app');
  const label = enabled ? t('pageTranslation.original') : t('pageTranslation.enable');
  return (
    <div className="flex shrink-0 items-center" translate="no">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant={enabled ? 'secondary' : 'ghost'} size="icon"
            aria-label={label} aria-pressed={Boolean(enabled)} onClick={() => { if (!enabled && needsConsent) setConsentOpen(true); else setEnabled(!enabled); }}>
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
      <ConfirmDialog isOpen={consentOpen} title={t('pageTranslation.consentTitle')} message={t('pageTranslation.consentBody')}
        confirmText={t('pageTranslation.enable')} cancelText={t('pageTranslation.consentCancel')} type="info"
        onCancel={() => setConsentOpen(false)} onConfirm={() => { acceptConsent(); setEnabled(true); setConsentOpen(false); }} />
    </div>
  );
}
