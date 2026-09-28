import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function RepositoryToolbarPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const findTarget = () => setTarget(document.getElementById('repository-toolbar-actions'));
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return target ? createPortal(children, target) : <>{children}</>;
}
