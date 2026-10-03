import { useEffect, useState } from 'react';
import { editionKey, type ChannelDailyEdition } from '../custom/model';

/** Keep the displayed edition stable while a scheduled run publishes another. */
export function useChannelEditionReading(editions: ChannelDailyEdition[]) {
  const latest = editions[0];
  const [reading, setReading] = useState<ChannelDailyEdition | undefined>(latest);
  const stored = reading && editions.find(e => editionKey(e) === editionKey(reading));
  const edition = stored || reading || latest;
  useEffect(() => {
    if (stored && stored !== reading) setReading(stored);
    else if (!reading && latest) setReading(latest);
  }, [stored, reading, latest]);
  const hasUpdate = Boolean(latest && edition && editionKey(latest) !== editionKey(edition)
    && (latest.date > edition.date || latest.date === edition.date
      && ((latest.generatedAt || '') > (edition.generatedAt || '') || latest.revision > edition.revision)));
  const select = (key: string) => setReading(editions.find(e => key === editionKey(e)
    || key === `${e.date}:${e.revision}` || key === e.generatedAt) || latest);
  return { edition, hasUpdate, select, show: setReading, showLatest: () => setReading(latest) };
}
