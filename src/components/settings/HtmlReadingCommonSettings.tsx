import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { useT } from '../../i18n/useT';
import { ReadingGroup, ReadingNumber, ReadingSelect, ReadingToggle } from './HtmlReadingFields';
import { Button } from '../ui/button';

type Controller = ReturnType<typeof useHtmlReading>;
export function HtmlReadingCommonSettings({ controller: c, onPreset, onMail }: {
  controller: Controller; onPreset: (preset: 'browse' | 'deep') => void; onMail: () => void;
}) {
  const t = useT('settings');
  const s = c.settings;
  const choose = (key: 'categoryIds' | 'channelIds', id: string, checked: boolean) => c.setSettings(old => ({ ...old, [key]: checked ? [...new Set([...old[key], id])] : old[key].filter(value => value !== id) }));
  const credential = c.mail.credential?.accountId === c.account ? c.mail.credential : null;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t('dailyReading.commonSettingsHint')}</p>
    <ReadingGroup title={t('htmlReadingUi.readingPreset')}>
      <ReadingSelect label={t('htmlReadingUi.readingPreset')} value={s.preset} options={[
        ['browse', t('htmlReadingUi.browseCompleteSummariesUsageAndMaintenanceCollapsed')],
        ['deep', t('htmlReadingUi.deepReadingCompleteSummariesAnalysisSectionsExpanded')],
      ]} onChange={value => onPreset(value as 'browse' | 'deep')}/>
    </ReadingGroup>
    <ReadingGroup title={t('htmlReadingUi.contentScope')}>
      <ReadingToggle label={t('htmlReadingUi.starredRepositories')} checked={s.repositories} onChange={value => c.setSettings(old => ({ ...old, repositories: value }))}/>
      {s.repositories && <>
        <ReadingNumber label={t('dailyReading.repositoryLimit')} value={s.repositoryLimit} min={1} max={10000} onChange={value => c.setSettings(old => ({ ...old, repositoryLimit: value }))}/>
        <details><summary className="cursor-pointer text-sm">{s.categoryIds.length ? t('htmlReadingUi.categories', { v1: s.categoryIds.length }) : t('htmlReadingUi.allCategories')}</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{[...c.catalog.categories,{id:'none',name:t('htmlReadingUi.uncategorized')}].map(category => <ReadingToggle key={category.id} label={category.name} checked={s.categoryIds.includes(category.id)} onChange={value => choose('categoryIds', category.id, value)}/>)}</div>
        </details>
      </>}
      <ReadingToggle label={t('htmlReadingUi.discovery')} checked={s.discovery} onChange={value => c.setSettings(old => ({ ...old, discovery: value }))}/>
      {s.discovery && <div className="grid gap-2 sm:grid-cols-2">{c.catalog.channels.map(channel => <ReadingToggle key={channel.id} label={channel.name} checked={s.channelIds.includes(channel.id)} onChange={value => choose('channelIds', channel.id, value)}/>)}</div>}
    </ReadingGroup>
    <ReadingGroup title={t('htmlReadingUi.readingStyle')}><div className="grid gap-4 sm:grid-cols-2">
      <ReadingSelect label={t('htmlReadingUi.bodyFontSize')} value={s.fontSize} options={['14', '16', '18', '20'].map(size => [size, `${size}px`])} onChange={value => c.setSettings(old => ({ ...old, fontSize: value as typeof s.fontSize }))}/>
      <ReadingSelect label={t('htmlReadingUi.cardDensity')} value={s.density} options={[['compact', t('htmlReadingUi.compact')], ['standard', t('htmlReadingUi.standard')]]} onChange={value => c.setSettings(old => ({ ...old, density: value as typeof s.density }))}/>
    </div></ReadingGroup>
    <ReadingGroup title={t('htmlReadingUi.emailDelivery')}>
      <p className="text-sm text-muted-foreground">{credential ? `${credential.from} → ${credential.to}` : t('htmlReadingUi.emailNotConfiguredForThisAccount')}</p>
      <ReadingToggle label={t('htmlReadingUi.enableDailyEmail')} checked={s.scheduleEnabled} onChange={value => c.setSettings(old => ({ ...old, scheduleEnabled: value }))}/>
      <label className="flex flex-wrap items-center gap-3 text-sm">{t('htmlReadingUi.dailyGenerationAndDeliveryTimeBeijingTime')}<input type="time" className="h-10 rounded-md border bg-background px-3" value={s.sendTime} onChange={event => c.setSettings(old => ({ ...old, sendTime: event.target.value }))}/></label>
      <Button variant="outline" onClick={onMail}>{t('dailyReading.configureMail')}</Button>
    </ReadingGroup>
  </div>;
}
