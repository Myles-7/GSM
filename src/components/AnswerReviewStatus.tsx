import type { RepositoryChatMessage } from '../types/repositoryChat';
import { useT } from '../i18n/useT';
import { useEffect, useState } from 'react';

export function AnswerReviewStatus({ message }: { message: RepositoryChatMessage }) {
  const t = useT('chat');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (message.status !== 'streaming') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [message.status]);
  if (message.role !== 'assistant') return null;
  const preview = message.answerPhase === 'draft' || message.answerPhase === 'reviewing';
  const label = preview ? (message.status === 'streaming'
    ? message.answerPhase === 'reviewing' ? 'reviewing' : 'draft' : 'interrupted')
    : message.quality === 'model-reviewed' ? 'reviewed' : message.quality === 'unreviewed' ? 'unreviewed' : 'legacy';
  return <div className="my-2 min-w-0 space-y-2 text-xs text-muted-foreground">
    <p role="status">{!message.content && message.status === 'streaming' ? t('repositoryChatSheet.generating') : t(`answerReview.${label}`)}</p>
    {message.status === 'streaming' && <span aria-hidden="true">{Math.max(0, Math.floor((now - Date.parse(message.createdAt)) / 1000))}s</span>}
    {!preview && !!message.coverage?.length && <details>
      <summary className="cursor-pointer">{t('answerReview.coverage')}</summary>
      <ul className="mt-2 space-y-2">
        {message.coverage.map((item, index) => <li key={index} className="break-words">
          <span className="font-medium">{t(`answerReview.${item.status}`)}: </span>{item.requirement}
          <blockquote className="mt-1 border-l-2 border-border pl-2">{item.answerExcerpt}</blockquote>
        </li>)}
      </ul>
    </details>}
    {!preview && !!message.claims?.length && <details>
      <summary className="cursor-pointer">{t('research.claims')}</summary>
      <ul className="mt-2 space-y-3">
        {message.claims.map((claim, index) => <li key={index} className="break-words">
          <p>{claim.text}</p>
          <blockquote className="mt-1 border-l-2 border-border pl-2">{claim.quote}</blockquote>
          <span className="break-all">{claim.evidenceId}</span>
        </li>)}
      </ul>
    </details>}
  </div>;
}
