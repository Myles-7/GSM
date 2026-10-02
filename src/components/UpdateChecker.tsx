import { getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ExternalLink, Package, RefreshCw } from 'lucide-react';
import { useUpdateActions, type VersionInfo } from '../features/settings/hooks/useUpdateActions';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { useScrollbarFlash } from '../hooks/useScrollbarFlash';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

interface UpdateCheckerProps {
  onUpdateAvailable?: (version: VersionInfo) => void;
}

export const UpdateChecker: React.FC<UpdateCheckerProps> = ({ onUpdateAvailable }) => {
  const { language } = useAppStore(useShallow((state) => ({
    language: state.language,
  })));
  const { toast } = useDialog();
  const { checkUpstreamUpdates, openDownloadUrl } = useUpdateActions();
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const { isScrolling: isChangelogScrolling, handleScroll: handleChangelogScroll } = useScrollbarFlash(showUpdateDialog);

  const t = useT('app');

  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const checkForUpdates = async () => {
    if (requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setIsChecking(true);
    setError(null);
    setUpdateInfo(null);
    setShowUpdateDialog(false);
    try {
      const result = await checkUpstreamUpdates(request.signal);
      if (request.signal.aborted) return;
      setUpdateInfo(result.latestVersion);
      setShowUpdateDialog(true);
      if (result.hasUpdate) onUpdateAvailable?.(result.latestVersion);
    } catch (error) {
      if (request.signal.aborted) return;
      const errorMessage = t('updateChecker.failed-to-check-for-updates-please-check-your-ne');
      setError(errorMessage);
      toast(errorMessage, 'error');
      console.error('Upstream update check failed:', error);
    } finally {
      if (!request.signal.aborted) {
        requestRef.current = null;
        setIsChecking(false);
      }
    }
  };

  const handleDownload = () => {
    if (updateInfo?.downloadUrl) {
      openDownloadUrl(updateInfo.downloadUrl);
      setShowUpdateDialog(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString(getIntlLocale(language));
    } catch {
      return dateString;
    }
  };

  return (
    <>
      <div className="flex flex-col items-start">
        <Button type="button" onClick={() => { void checkForUpdates(); }} disabled={isChecking} className="gap-2">
          <RefreshCw className={cn('h-4 w-4', isChecking && 'animate-spin')} />
          <span>{isChecking ? t('updateChecker.checking') : t('updateChecker.check-for-updates')}</span>
        </Button>

        {error && <div role="alert" className="mt-2 rounded-lg border border-border bg-muted p-3 dark:border-border dark:bg-muted/40"><p className="text-sm text-muted-foreground dark:text-muted-foreground">{error}</p></div>}
      </div>

      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent className="max-w-2xl flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0" closeLabel={t('updateChecker.close')}>
          <DialogHeader className="shrink-0 space-y-3 border-b border-border px-6 py-5 pr-12">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20"><Package className="h-6 w-6 text-primary" /></div>
              <div><DialogTitle>{t('updateChecker.new-version-available')} v{updateInfo?.number}</DialogTitle><DialogDescription>{t('generalPanel.check-if-a-new-version-is-available')}</DialogDescription></div>
            </div>
            {updateInfo && <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground"><Calendar className="h-4 w-4" /><span>{t('updateChecker.release-date')} {formatDate(updateInfo.releaseDate)}</span></div>}
          </DialogHeader>
          {updateInfo && (
            <div
              className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-on-scroll', isChangelogScrolling && 'scrolling')}
              onScroll={handleChangelogScroll}
              tabIndex={0}
              role="region"
              aria-label={t('updateChecker.what-s-new')}
            >
              <h4 className="mb-2 font-medium text-foreground dark:text-foreground">{t('updateChecker.what-s-new')}</h4>
              <ul className="space-y-1">{updateInfo.changelog.map((item, index) => <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground dark:text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{item}</span></li>)}</ul>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" onClick={handleDownload} className="gap-2"><ExternalLink className="h-4 w-4" /><span>{t('updateChecker.download-now')}</span></Button>
            <Button type="button" variant="outline" onClick={() => setShowUpdateDialog(false)}>{t('updateChecker.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
