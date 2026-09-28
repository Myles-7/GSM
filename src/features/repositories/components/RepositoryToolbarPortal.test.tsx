import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepositoryToolbarPortal } from './RepositoryToolbarPortal';

describe('RepositoryToolbarPortal', () => {
  it('renders inline without a target, then follows a late-mounted toolbar target', async () => {
    const { container } = render(<RepositoryToolbarPortal><button>Action</button></RepositoryToolbarPortal>);
    expect(container).toContainElement(screen.getByRole('button'));
    const target = document.createElement('div');
    target.id = 'repository-toolbar-actions';
    document.body.appendChild(target);
    await waitFor(() => expect(target).toContainElement(screen.getByRole('button')));
    target.remove();
    await waitFor(() => expect(container).toContainElement(screen.getByRole('button')));
  });
});
