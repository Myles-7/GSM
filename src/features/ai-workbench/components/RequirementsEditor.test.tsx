import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequirementsEditor } from './RequirementsEditor';
import type { WorkbenchRequirements } from '../../../types/aiWorkbench';

vi.mock('../../../i18n/useT', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => params?.condition ? `${key}: ${params.condition}` : key,
}));
const requirements: WorkbenchRequirements = {
  purpose: 'Mathematical modeling tools', required: ['Python'], preferred: [], excluded: [],
  questions: [], queries: ['old-query'],
};
const props = () => ({ value: requirements, disabled: false, depth: 'standard' as const, onSearch: vi.fn().mockResolvedValue(undefined) });

describe('RequirementsEditor', () => {
  it('shows a compact summary without blank textareas or empty category headings', () => {
    const { container } = render(<RequirementsEditor {...props()} />);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(screen.getByText(requirements.purpose)).toBeInTheDocument();
    expect(screen.queryByText('workbench.excluded')).not.toBeInTheDocument();
  });

  it('suggestions stay optional and are included only after an explicit click', async () => {
    const p = props();
    render(<RequirementsEditor {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.suggestExamples' }));
    fireEvent.click(screen.getByRole('button', { name: 'workbench.startSearch' }));
    await waitFor(() => expect(p.onSearch).toHaveBeenCalledWith(expect.objectContaining({
      preferred: ['requirementsEditor.suggestExamples'], required: ['Python'], queries: [],
    })));
  });

  it('adds, edits, moves and removes individual conditions', async () => {
    const p = props();
    render(<RequirementsEditor {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.addCondition' }));
    fireEvent.change(screen.getByLabelText('requirementsEditor.condition'), { target: { value: 'Offline' } });
    fireEvent.change(screen.getByLabelText('requirementsEditor.priority'), { target: { value: 'required' } });
    fireEvent.keyDown(screen.getByLabelText('requirementsEditor.condition'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Offline' }));
    fireEvent.change(screen.getByLabelText('requirementsEditor.condition'), { target: { value: 'Cloud only' } });
    fireEvent.change(screen.getByLabelText('requirementsEditor.priority'), { target: { value: 'excluded' } });
    fireEvent.click(screen.getByRole('button', { name: 'workbench.save' }));
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.removeCondition: Python' }));
    fireEvent.click(screen.getByRole('button', { name: 'workbench.startSearch' }));
    await waitFor(() => expect(p.onSearch).toHaveBeenCalledWith(expect.objectContaining({ required: [], excluded: ['Cloud only'] })));
  });

  it('preserves local edits across equivalent refreshes and changed AI suggestions', async () => {
    const p = props();
    const { rerender } = render(<RequirementsEditor {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.editPurpose' }));
    fireEvent.change(screen.getByLabelText('workbench.purpose'), { target: { value: 'My edited purpose' } });
    fireEvent.blur(screen.getByLabelText('workbench.purpose'));
    rerender(<RequirementsEditor {...p} value={{ ...requirements, required: [...requirements.required] }} />);
    expect(screen.getByText('My edited purpose')).toBeInTheDocument();
    rerender(<RequirementsEditor {...p} value={{ ...requirements, purpose: 'AI replaced purpose' }} />);
    expect(screen.getByText('My edited purpose')).toBeInTheDocument();
    expect(screen.getByText('requirementsEditor.draftPreserved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.useNew' }));
    expect(screen.getByText('AI replaced purpose')).toBeInTheDocument();
  });

  it('collapses after success, expands for review and preserves the original input', async () => {
    const p = props();
    render(<RequirementsEditor {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'workbench.startSearch' }));
    await screen.findByText('requirementsEditor.confirmed');
    expect(screen.queryByRole('button', { name: 'workbench.startSearch' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.expand' }));
    expect(screen.getByRole('button', { name: 'Python' })).toBeInTheDocument();
    expect(requirements.queries).toEqual(['old-query']);
  });

  it('keeps failed searches editable and preserves additional notes for retry', async () => {
    const p = props();
    p.onSearch.mockRejectedValueOnce(new Error('Rate limit'));
    render(<RequirementsEditor {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.note' }));
    fireEvent.change(screen.getByLabelText('requirementsEditor.note'), { target: { value: 'University use only' } });
    fireEvent.click(screen.getByRole('button', { name: 'workbench.startSearch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limit');
    expect(screen.getByLabelText('requirementsEditor.note')).toHaveValue('University use only');
    expect(p.onSearch).toHaveBeenCalledWith(expect.objectContaining({ preferred: ['University use only'] }));
  });

  it('disables condition mutation while a task runs and leaves viewing available', () => {
    render(<RequirementsEditor {...props()} disabled />);
    expect(screen.getByRole('button', { name: 'Python' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'requirementsEditor.removeCondition: Python' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'workbench.startSearch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'requirementsEditor.collapse' })).toBeEnabled();
  });

  it('answers a clarification through an explicit condition without silently selecting defaults', async () => {
    const p = props();
    render(<RequirementsEditor {...p} value={{ ...requirements, questions: ['Need a GUI?'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'requirementsEditor.answer' }));
    fireEvent.change(screen.getByLabelText('requirementsEditor.condition'), { target: { value: 'A GUI is required' } });
    fireEvent.change(screen.getByLabelText('requirementsEditor.priority'), { target: { value: 'required' } });
    fireEvent.click(screen.getByRole('button', { name: 'workbench.save' }));
    expect(screen.queryByText('Need a GUI?')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region')).getByRole('button', { name: 'workbench.startSearch' }));
    await waitFor(() => expect(p.onSearch).toHaveBeenCalledWith(expect.objectContaining({ required: ['Python', 'A GUI is required'], questions: [] })));
  });
});
