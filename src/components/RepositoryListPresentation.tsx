import { useT } from '../i18n/useT';

export const repositoryListDescriptionClass = 'text-sm leading-6 text-muted-foreground line-clamp-4 break-words transition-colors duration-200 [text-wrap:pretty] hover:text-foreground';
export const repositoryListSurfaceClass = 'repository-card repository-card--list ui-card group relative px-5 py-4 transition-[color,background-color,border-color,box-shadow] duration-200 cursor-pointer';
export { RepositoryLanguageStars } from './RepositoryLanguageStars';
export function RepositorySoftwareForms({ forms }: { forms: string[] }) {
  const t = useT('repositories');
  return forms.length ? <div className="flex flex-wrap gap-1" aria-label={t('details.softwareForms')}>
    {forms.map(form => <span key={form} data-software-form={form} className="linear-card-tag px-1.5 py-0.5 text-xs">{t(`details.forms.${form}`)}</span>)}
  </div> : null;
}
