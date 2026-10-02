import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryChannel } from '../types';
import { defaultDiscoveryChannels } from '../store/schema';
import { DiscoverySidebar } from './DiscoverySidebar';

describe('external feeds with local Custom Discovery', () => {
  it('keeps external names, missing map defaults and independent custom navigation', async () => {
    const channel: DiscoveryChannel = {
      id: 'external:one', name: 'My external feed', nameEn: 'My external feed', icon: 'search',
      sourceUrl: 'https://example.com/feed', description: '', enabled: true,
    };
    const select = vi.fn();
    const customSelect = vi.fn();
    const props = {
      channels: [...defaultDiscoveryChannels, channel], selectedChannel: channel.id,
      onChannelSelect: select, onToggleChannel: vi.fn(), onRefreshAll: vi.fn(),
      isLoading: {}, lastRefresh: {}, isAnalyzing: false, language: 'en' as const,
      customNavigation: <button onClick={customSelect}>Local Custom Subscription</button>,
    };
    render(<DiscoverySidebar {...props} />);
    const external = screen.getByRole('button', { name: 'My external feed' });
    expect(external).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(external);
    expect(select).toHaveBeenCalledWith('external:one');
    expect(customSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Local Custom Subscription' }));
    expect(customSelect).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
  });
});
