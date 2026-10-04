import { useT } from '../i18n/useT';

export { RepositoryLanguageStars } from './RepositoryLanguageStars';
export function RepositorySoftwareForms({ forms }: { forms: string[] }) {
  const t = useT('repositories');
  return forms.length ? <div className="flex flex-wrap gap-1" aria-label={t('details.softwareForms')}>
    {forms.map(form => <span key={form} data-software-form={form} className="linear-card-tag px-1.5 py-0.5 text-xs">{t(`details.forms.${form}`)}</span>)}
  </div> : null;
}
