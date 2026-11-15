/** Scroll the target section into view, expand it if collapsed, and focus its first control. */
export const revealSection = (id: string) => {
  const element = document.getElementById(id);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    element.querySelector<HTMLElement>('input, select, button')?.focus();
  }, 250);
};
