import { useState } from 'react';
import { ArrowLeft, ChevronRight, Layers, Mail, Palette, HardDrive } from 'lucide-react';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';
import { HtmlReadingConfiguration } from '../settings/HtmlReadingPanel';

type Controller = ReturnType<typeof useHtmlReading>;
type Group = 'content' | 'layout' | 'mail' | 'storage';
export function ReadingConfiguration({ controller: c, group, onGroup }: { controller: Controller; group: Group | null; onGroup: (group: Group | null) => void }) {
  const t = useT('settings');
  const s = c.settings;
  const credential = c.mail.credential?.accountId === c.account ? c.mail.credential : null;
  const [visited, setVisited] = useState<Set<Group>>(new Set());
  const groups = [
    { id: 'content' as const, icon: Layers, summary: t('readingClean.contentSummary', { repositories: s.repositories ? s.repositoryLimit : 0, channels: s.discovery ? s.channelIds.length : 0 }) },
    { id: 'layout' as const, icon: Palette, summary: `${s.fontSize}px · ${t(`htmlReadingUi.${s.density}`)} · ${t(s.autoRead ? 'readingClean.autoRead' : 'readingClean.manualRead')}` },
    { id: 'mail' as const, icon: Mail, summary: credential ? `${credential.to} · ${s.scheduleEnabled ? `${s.sendTime} ${t('readingClean.beijing')}` : t('htmlReadingUi.dailyDeliveryDisabled')}` : t('htmlReadingUi.emailNotConfiguredForThisAccount') },
    { id: 'storage' as const, icon: HardDrive, summary: t('readingClean.storageSummary', { size: s.maxFileMb, days: s.artifactRetentionDays }) },
  ];
  const open = (value: Group) => { setVisited(old => new Set([...old, value])); onGroup(value); };
  return <div className="reading-configuration">
    {!group && <div className="reading-group-grid">{groups.map(({ id, icon: Icon, summary }) => <button className="reading-group-link" key={id} onClick={() => open(id)}><Icon className="h-5 w-5 shrink-0 text-muted-foreground"/><span><strong>{t(`readingClean.groups.${id}`)}</strong><small>{summary}</small></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground"/></button>)}</div>}
    {group && <div className="reading-edit-header"><Button size="icon" variant="ghost" aria-label={t('readingClean.backToConfiguration')} onClick={() => onGroup(null)}><ArrowLeft className="h-4 w-4"/></Button><h2>{t(`readingClean.groups.${group}`)}</h2></div>}
    {groups.filter(({ id }) => visited.has(id) || group === id).map(({ id }) => <div key={`${c.account}:${id}`} hidden={group !== id} className="space-y-4"><HtmlReadingConfiguration controller={c} simple={false} embeddedSection={id}/>{id === 'content' && <HtmlReadingConfiguration controller={c} simple={false} embeddedSection="channels"/>}</div>)}
  </div>;
}
