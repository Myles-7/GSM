import { Plus, Settings2, Trash2 } from 'lucide-react';
import type { AppLanguage } from '../i18n/languages';
import { discoveryChannelDisplayName as discoveryChannelName } from '../features/discovery/application/discoveryChannelDisplayName';
import { useT } from '../i18n/useT';
import type { DiscoveryChannel, DiscoveryChannelId } from '../types';
import { isExternalDiscoveryChannelId } from '../services/externalFeedConfig';
import type { ExternalDiscoveryChannelId } from '../types/externalFeed';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface DiscoveryChannelMenuProps {
  channels: DiscoveryChannel[];
  language: AppLanguage;
  onToggleChannel: (channelId: DiscoveryChannelId) => void;
  onAddExternalFeed?: () => void;
  onRemoveExternalFeed?: (channelId: ExternalDiscoveryChannelId) => void;
  triggerClassName?: string;
}

export function DiscoveryChannelMenu({
  channels,
  language,
  onToggleChannel,
  onAddExternalFeed,
  onRemoveExternalFeed,
  triggerClassName,
}: DiscoveryChannelMenuProps) {
  const t = useT('discovery');
  const enabledCount = channels.filter(channel => channel.enabled).length;
  const label = t('discoverySidebar.manage-channels');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label={label}
          title={label}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] min-w-48 max-w-[calc(100vw-2rem)] overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {channels.map(channel => (
          <DropdownMenuCheckboxItem
            key={channel.id}
            checked={channel.enabled}
            disabled={channel.enabled && enabledCount === 1}
            onCheckedChange={() => onToggleChannel(channel.id)}
            onSelect={event => event.preventDefault()}
          >
            <span className="break-words">{discoveryChannelName(channel, language)}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {onAddExternalFeed && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onAddExternalFeed}>
            <Plus className="mr-2 h-4 w-4 shrink-0" />
            {t('externalFeeds.add', { defaultValue: 'Add External Feed' })}
          </DropdownMenuItem>
        </>}
        {onRemoveExternalFeed && channels.filter(channel => isExternalDiscoveryChannelId(channel.id)).map(channel => (
          <DropdownMenuItem key={`remove-${channel.id}`}
            onSelect={() => { if (isExternalDiscoveryChannelId(channel.id)) onRemoveExternalFeed(channel.id); }}>
            <Trash2 className="mr-2 h-4 w-4 shrink-0" />
            <span className="break-words">
              {t('externalFeeds.remove', { defaultValue: 'Remove {{name}}', name: channel.name })}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
