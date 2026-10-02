import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeT } from '../../i18n/useT';
import { APP_LANGUAGES } from '../../i18n/languages';
import { AppearancePanel } from './AppearancePanel';

const mocks = vi.hoisted(() => ({ state: { language: 'zh', setLanguage: vi.fn() } }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));
vi.mock('./ThemeSettingsCard', () => ({ ThemeSettingsCard: () => <div>Theme and card fields</div> }));
const t = makeT('zh', 'app');
beforeEach(() => vi.clearAllMocks());

describe('Appearance settings', () => {
  it('moves theme, card fields and the full responsive language grid into Appearance', () => {
    const { container } = render(<AppearancePanel t={t} />);
    expect(screen.getByText('Theme and card fields')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(APP_LANGUAGES.length);
    expect(container.querySelector('[aria-labelledby="language-settings-title"]')?.className)
      .toContain('grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]');
  });
  it('changes language using the existing store action', async () => {
    render(<AppearancePanel t={t} />);
    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(mocks.state.setLanguage).toHaveBeenCalledWith('en');
  });
});
