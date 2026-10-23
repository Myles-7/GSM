import { LayoutGrid, List, Share2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useT } from '../../../i18n/useT';

export function RepositoryViewControls({ mode, onChange }: { mode: 'grid' | 'list' | 'cluster'; onChange: (mode: 'grid' | 'list' | 'cluster') => void }) {
  const t = useT('repositories');
  return <div className="repository-view-controls" role="group" aria-label={t('repositoryList.repository-layout')}>
    {([{ id: 'grid', label: t('repositoryList.grid-view'), Icon: LayoutGrid }, { id: 'list', label: t('repositoryList.list-view'), Icon: List }, { id: 'cluster', label: t('exploration.project-map'), Icon: Share2 }] as const).map(({ id, label, Icon }) =>
      <Button key={id} size="sm" variant={mode === id ? 'secondary' : 'ghost'} aria-label={label} aria-pressed={mode === id} title={label} onClick={() => onChange(id)}><Icon size={16}/><span>{label}</span></Button>)}
  </div>;
}
