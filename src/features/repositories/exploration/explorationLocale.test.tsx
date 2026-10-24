import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavedExplorations } from './SavedExplorations';
import { ExplorationTaskStatus } from './ExplorationTaskStatus';

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }),
}));

describe('English exploration interface', () => {
  it('localizes empty saved explorations and accessible navigation', () => {
    render(<SavedExplorations workspaces={[]} snapshots={[]} selected="" atHome busy={false} onOpen={vi.fn()} onHome={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onNew={vi.fn()} onConvert={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Saved explorations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Library map' })).toBeInTheDocument();
    expect(screen.getByText('No saved explorations yet')).toBeInTheDocument();
  });

  it('localizes resumable task actions and interpolates remaining items', () => {
    render(<ExplorationTaskStatus ownerId="42" busy={false} error="" message="" preview={false} readyCount={1} model="Test" elapsed={0} concurrency={1} activity="" canRun recoveryStorageFull={false}
      task={{ id: 'task', type: 'build', status: 'failed', startedAt: '', model: 'test', fingerprint: '', completed: 1, total: 3, draft: {} }}
      onRetry={vi.fn()} onCancel={vi.fn()} onTasks={vi.fn()} onConfigure={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Map task status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue 2 remaining items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task history' })).toBeInTheDocument();
  });
});
