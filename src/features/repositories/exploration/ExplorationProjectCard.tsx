import { useT } from '../../../i18n/useT';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowUpRight, Network } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { Repository } from '../../../types';
import type { ExplorationEvidence, ExplorationResult, ExplorationTopic, ExplorationEntity, ExplorationFocus } from './types';
import { repositorySummary } from './model';

export function ExplorationEvidenceList({ evidence }: { evidence: ExplorationEvidence[] }) {
  const t = useT('repositories');
  return <div className="explore-evidence">{evidence.length ? evidence.map(item => <div key={item.id}><span>{['readme', 'document'].includes(item.kind) ? item.verified ? t('exploration.source-text') : t('exploration.source-text-relationship-unverified') : t('exploration.existing-analysis-metadata-unverified')} · {item.label}</span><blockquote>{item.text}</blockquote>{item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{t('exploration.view-source')}</a>}<time>{new Date(item.retrievedAt).toLocaleDateString()}</time></div>) : <p>{t('exploration.no-verifiable-source-text-for-this-relationship-treat')}</p>}</div>;
}
interface Props {
  repository: Repository; result?: ExplorationResult; anchor?: Element; positionKey: string; docked?: boolean;
  onClose: () => void; onOpen: () => void; onExplore: () => void; onEditTopics: () => void;
  onRemoveRelation: (id: string) => void;
  topics: ExplorationTopic[]; entities: ExplorationEntity[]; onFocus: (focus: ExplorationFocus) => void;
}
export function ExplorationProjectCard({ repository, result, anchor, positionKey, docked, onClose, onOpen, onExplore, onEditTopics, onRemoveRelation, topics, entities, onFocus }: Props) {
  const t = useT('repositories');
  const ref = useRef<HTMLDivElement>(null); const [position, setPosition] = useState({ left: 12, top: 100 });
  useLayoutEffect(() => {
    if (docked || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect(); const card = ref.current?.getBoundingClientRect(); const width = card?.width ?? 320, height = card?.height ?? 300;
      setPosition({ left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.right + width + 24 <= window.innerWidth ? rect.right + 12 : rect.left - width - 12)), top: Math.max(12, Math.min(window.innerHeight - height - 12, rect.top)) });
    };
    place(); const observer = new ResizeObserver(place); if (ref.current) observer.observe(ref.current);
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, positionKey, docked]);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => { if (!docked && !ref.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { onClose(); if (anchor instanceof HTMLElement) anchor.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, onClose, docked]);
  const content = <div ref={ref} role={docked ? 'region' : 'dialog'} aria-label={repository.full_name} className={`explore-project-popover ${docked ? 'is-docked' : ''}`} style={docked ? undefined : position}>
    <header><div><h3>{repository.name}</h3><p>{repository.full_name}</p></div><Button size="icon" variant="ghost" aria-label={t('exploration.close-project-card')} onClick={onClose}><X size={16} /></Button></header>
    <p className="explore-popover-summary">{repositorySummary(repository)}</p>
    <div className="explore-ecosystems">{topics.map(topic => <button key={topic.id} onClick={() => onFocus({ type: 'topic', ...topic })}>{topic.label}</button>)}{entities.map(entity => <button key={entity.id} onClick={() => onFocus({ type: 'entity', id: entity.id, label: entity.label })}>{entity.label} ↗</button>)}</div>
    {result && <><p className="explore-result-reason">{result.reason}</p><details><summary>{t('exploration.view-relationships-and-evidence')}</summary><ExplorationEvidenceList evidence={result.evidence} />{result.relations.map(relation => <div className="explore-relation-correction" key={relation.id}><span>{t(`exploration.relations.${relation.kind}`)} · {relation.branch}</span><button onClick={() => onRemoveRelation(relation.id)}>{t('exploration.this-relationship-is-incorrect')}</button></div>)}</details></>}
    <div className="explore-popover-actions"><Button variant="outline" size="sm" onClick={onExplore}><Network size={13} /> {' '}{t('exploration.explore-from-this-project')}</Button><Button size="sm" onClick={onOpen}><ArrowUpRight size={13} /> {' '}{t('exploration.full-details')}</Button><Button variant="ghost" size="sm" onClick={onEditTopics}>{t('exploration.edit-exploration-topics')}</Button></div>
  </div>;
  return docked ? content : createPortal(content, document.body);
}
