import type { ReactNode } from 'react';

export function RepositoryGrid({ children, viewMode }: { children: ReactNode; viewMode: 'grid' | 'list' }) {
  return (
    <div className="repository-grid grid min-w-0 gap-4" data-view-mode={viewMode}>
      {children}
    </div>
  );
}
