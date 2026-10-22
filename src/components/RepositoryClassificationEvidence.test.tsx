import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { projectClassificationRepository } from '../store/helpers/classificationSchemes';
import { RepositoryClassificationEvidence } from './RepositoryClassificationEvidence';
vi.mock('../store/useAppStore', () => ({ useAppStore: (select: (state: unknown) => unknown) => select({
  language: 'en', customCategories: [{ id: 'purpose', name: 'Knowledge tools', icon: '', keywords: [] }], defaultCategoryOverrides: {},
  subcategories: [{ id: 'notes', parentId: 'purpose', name: 'Notes', icon: '' }],
  classificationSchemes: { technology: { customCategories: [{ id: 'tech', name: 'Web interfaces' }], subcategories: [{ id: 'react', parentId: 'tech', name: 'React' }] } },
}) }));
const repository = { id: 1, category_id: 'purpose', subcategory_id: 'notes', classifications: {
  purpose: { categoryId: 'purpose', subcategoryId: 'notes', locked: false }, technology: { categoryId: 'tech', subcategoryId: 'react', locked: false },
}, classificationInsights: { purpose: { categoryId: 'purpose', confidence: 'medium', evidence: ['README describes personal notes'], facets: [] },
  technology: { categoryId: 'tech', confidence: 'low', evidence: ['AI architecture names React'], facets: [{ id: 'web', label: 'Browser', score: 7, evidence: ['platforms: Browser'], group: 'platform' }] } } } as unknown as Repository;
describe('saved classification evidence presentation', () => {
  it('shows full paths and saved evidence for a projected repository without confidence presentation', () => {
    const raw = { ...repository, classifications: { technology: repository.classifications!.technology } };
    const projected = projectClassificationRepository(raw, 'technology');
    expect(raw.classifications).not.toHaveProperty('purpose');
    expect(projected.classifications?.purpose?.categoryId).toBe('purpose');
    render(<RepositoryClassificationEvidence repository={{ ...projected }} />);
    expect(screen.getByText('Purpose: Knowledge tools / Notes')).toBeInTheDocument();
    expect(screen.getByText('Technology: Web interfaces / React')).toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.getByText('README describes personal notes')).toBeInTheDocument();
    expect(screen.getByText('Browser')).toHaveAttribute('title', 'platforms: Browser');
    expect(screen.getByText('README describes personal notes').closest('details')).not.toHaveAttribute('open');
  });
  it('prefers canonical purpose fields over stale persisted purpose memberships', () => {
    render(<RepositoryClassificationEvidence repository={{ ...repository, classifications: { ...repository.classifications, purpose: { categoryId: 'obsolete-purpose', subcategoryId: null, locked: false } } }} compact />);
    expect(screen.getByText('Purpose: Notes')).toHaveAttribute('title', 'Purpose: Knowledge tools / Notes');
  });
  it('never infers low confidence merely from missing AI analysis', () => {
    render(<RepositoryClassificationEvidence repository={{ ...repository, classificationInsights: undefined }} compact />);
    expect(screen.queryByText('Low-confidence classification')).not.toBeInTheDocument();
  });
  it('uses short child labels with full path tooltips and no evidence or confidence in compact mode', () => {
    const { container } = render(<RepositoryClassificationEvidence repository={repository} compact />);
    expect(screen.getByText('Purpose: Notes')).toHaveAttribute('title', 'Purpose: Knowledge tools / Notes');
    expect(screen.getByText('Technology: React')).toHaveAttribute('title', 'Technology: Web interfaces / React');
    expect(screen.queryByText('README describes personal notes')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/confidence/i);
    expect(container.innerHTML).not.toMatch(/amber|confidence/i);
  });
  it('falls back to the parent name when there is no valid child', () => {
    render(<RepositoryClassificationEvidence repository={{ ...repository, subcategory_id: 'missing' }} compact />);
    expect(screen.getByText('Purpose: Knowledge tools')).toHaveAttribute('title', 'Purpose: Knowledge tools');
  });
  it('does not attach stale evidence or facets to a manually changed category or child', () => {
    const { rerender } = render(<RepositoryClassificationEvidence repository={{ ...repository, classificationInsights: { technology: { ...repository.classificationInsights!.technology!, categoryId: 'old-tech' } } }} />);
    expect(screen.queryByText('AI architecture names React')).not.toBeInTheDocument();
    expect(screen.queryByText('Browser')).not.toBeInTheDocument();
    rerender(<RepositoryClassificationEvidence repository={{ ...repository, classificationInsights: { technology: { ...repository.classificationInsights!.technology!, subcategoryId: 'old-child' } } }} />);
    expect(screen.queryByText('AI architecture names React')).not.toBeInTheDocument();
  });
  it('retains every saved facet and its evidence in details', () => {
    render(<RepositoryClassificationEvidence repository={{ ...repository, classificationInsights: { purpose: { ...repository.classificationInsights!.purpose!, refinementReason: 'Stored refinement reason', facets: Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `Facet ${i}`, score: 7, evidence: [`Saved source ${i}`] })) } } }} />);
    expect(screen.getByText('Stored refinement reason')).toBeInTheDocument();
    expect(screen.getByText('Facet 5')).toHaveAttribute('title', 'Saved source 5');
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });
});
