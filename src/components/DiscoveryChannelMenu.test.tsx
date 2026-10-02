import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultDiscoveryChannels } from '../store/schema';
import { DiscoveryChannelMenu } from './DiscoveryChannelMenu';
import { makeT } from '../i18n/useT';

describe('DiscoveryChannelMenu', () => {
  it('lets the user hide an unwanted channel', async () => {
    const onToggleChannel = vi.fn();
    const user = userEvent.setup();
    render(<DiscoveryChannelMenu channels={defaultDiscoveryChannels} language="zh"
      onToggleChannel={onToggleChannel} />);

    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    const telegram = screen.getByRole('menuitemcheckbox', { name: 'Telegram 频道' });
    expect(telegram).toHaveAttribute('aria-checked', 'true');
    await user.click(telegram);

    expect(onToggleChannel).toHaveBeenCalledWith('telegram');
  });

  it('keeps the last visible channel enabled', async () => {
    const user = userEvent.setup();
    const channels = defaultDiscoveryChannels.map(channel => ({
      ...channel,
      enabled: channel.id === 'trending',
    }));
    render(<DiscoveryChannelMenu channels={channels} language="zh"
      onToggleChannel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    expect(screen.getByRole('menuitemcheckbox', { name: '趋势' })).toHaveAttribute('data-disabled');
  });

  it('adds and removes external feeds without exposing built-ins to deletion', async () => {
    const t = makeT('zh', 'discovery');
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const channels = [...defaultDiscoveryChannels, {
      id: 'external:one' as const, name: 'External Feed', nameEn: 'External Feed',
      icon: 'search' as const, description: '', enabled: true, sourceUrl: 'https://example.com/feed',
    }];
    render(<DiscoveryChannelMenu channels={channels} language="en" onToggleChannel={vi.fn()}
      onAddExternalFeed={onAdd} onRemoveExternalFeed={onRemove} />);
    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'External Feed' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Remove Trending/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: t('externalFeeds.add', { defaultValue: 'Add External Feed' }) }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '管理发现频道' }));
    await user.click(screen.getByRole('menuitem', {
      name: t('externalFeeds.remove', { defaultValue: 'Remove {{name}}', name: 'External Feed' }),
    }));
    expect(onRemove).toHaveBeenCalledWith('external:one');
  });
});
