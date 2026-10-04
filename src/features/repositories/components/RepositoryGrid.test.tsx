import { Profiler } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RepositoryGrid } from './RepositoryGrid';

it('lays out cards without measuring the DOM or forcing a second commit', () => {
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const commits = vi.fn();
  try {
    render(<Profiler id="grid" onRender={commits}><RepositoryGrid viewMode="grid"><button>Card</button></RepositoryGrid></Profiler>);
    expect(screen.getByRole('button', { name: 'Card' })).toBeVisible();
    expect(geometry).not.toHaveBeenCalled();
    expect(commits).toHaveBeenCalledOnce();
  } finally { geometry.mockRestore(); }
});
