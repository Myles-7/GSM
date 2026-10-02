import { useId, useState } from 'react';
import { Loader2, Plus, Rss } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useExternalFeed } from '../features/discovery/hooks/useExternalFeed';
import type { ExternalFeedKind } from '../types/externalFeed';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

export function AddExternalFeed({ onClose }: { onClose: () => void }) {
  const t = useT('discovery');
  const { add, isChecking, error, clearError } = useExternalFeed();
  const id = useId();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<ExternalFeedKind>('json');
  const title = t('externalFeeds.add', { defaultValue: 'Add External Feed' });
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} closeLabel={t('externalFeeds.close', { defaultValue: 'Close' })}>
        <DialogTitle className="pr-6 text-lg tracking-normal">{title}</DialogTitle>
        <form className="min-w-0 space-y-4" onSubmit={event => {
          event.preventDefault();
          if (!isChecking) void add(name, url, kind).then(added => { if (added) onClose(); });
        }}>
          <div role="group" aria-label={t('externalFeeds.kind', { defaultValue: 'Feed format' })} className="flex gap-1">
            {(['json', 'rss'] as const).map(value => (
              <Button key={value} type="button" variant={kind === value ? 'secondary' : 'ghost'}
                aria-pressed={kind === value} disabled={isChecking}
                onClick={() => { setKind(value); clearError(); }}>
                {value === 'rss' && <Rss className="mr-2 h-4 w-4" />}
                {value === 'rss' ? 'RSS / Atom' : 'JSON'}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">{t('externalFeeds.name', { defaultValue: 'Feed name' })}</label>
            <Input id={`${id}-name`} autoFocus value={name} maxLength={60} required disabled={isChecking}
              onChange={event => { setName(event.target.value); clearError(); }} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-url`} className="text-sm font-medium">{t('externalFeeds.url', { defaultValue: 'Public HTTPS URL' })}</label>
            <Input id={`${id}-url`} type="url" value={url} maxLength={2048} required disabled={isChecking}
              placeholder={kind === 'json' ? 'https://example.com/feed.json' : 'https://example.com/feed.xml'}
              onChange={event => { setUrl(event.target.value); clearError(); }} />
          </div>
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={isChecking || !name.trim() || !url.trim()}>
              {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {isChecking ? t('externalFeeds.checking', { defaultValue: 'Checking feed...' }) : title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
