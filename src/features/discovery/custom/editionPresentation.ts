import type { ChannelDailyEdition } from './model';

export function getEditionKey(e: ChannelDailyEdition): string {
  return `${e.date}:${e.revision}:${e.generatedAt || ''}`;
}

export function matchEdition(e: ChannelDailyEdition, key: string): boolean {
  if (!key) return false;
  return key === getEditionKey(e) || key === `${e.date}:${e.revision}` || key === e.generatedAt;
}

export function formatNaturalDate(dateStr: string, zh: boolean, now = new Date()): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;

  const targetDate = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - targetDate.getTime()) / 86400000);

  if (diffDays === 0) {
    return zh ? `今天 ${m}月${d}日` : `Today, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (diffDays === 1) {
    return zh ? `昨天 ${m}月${d}日` : `Yesterday, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (diffDays === 2) {
    return zh ? `前天 ${m}月${d}日` : `${diffDays} days ago, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (y === now.getFullYear()) {
    return zh ? `${m}月${d}日` : targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return zh ? `${y}年${m}月${d}日` : targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTimeLabel(generatedAt: string | undefined, isLatest: boolean, zh: boolean): string {
  if (!generatedAt) return isLatest ? (zh ? '最新' : 'Latest') : '';
  const d = new Date(generatedAt);
  if (isNaN(d.getTime())) return isLatest ? (zh ? '最新' : 'Latest') : '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  if (isLatest) {
    return `${timeStr} ${zh ? '最新' : 'Latest'}`;
  }
  const hour = d.getHours();
  let timeOfDay = '';
  if (hour < 12) timeOfDay = zh ? '早间' : 'Morning';
  else if (hour < 18) timeOfDay = zh ? '午间' : 'Afternoon';
  else timeOfDay = zh ? '晚间' : 'Evening';
  return `${timeStr} ${timeOfDay}`;
}

export interface DateEditionGroup {
  date: string;
  naturalDate: string;
  latest: ChannelDailyEdition;
  earlier: ChannelDailyEdition[];
}

export function groupEditionsByDate(editions: ChannelDailyEdition[], zh: boolean, now = new Date()): DateEditionGroup[] {
  const sorted = [...editions].sort((a, b) =>
    b.date.localeCompare(a.date)
    || (b.generatedAt || '').localeCompare(a.generatedAt || '')
    || b.revision - a.revision
  );

  const groups: DateEditionGroup[] = [];
  const map = new Map<string, ChannelDailyEdition[]>();

  for (const ed of sorted) {
    if (!map.has(ed.date)) {
      map.set(ed.date, []);
    }
    map.get(ed.date)!.push(ed);
  }

  for (const [date, items] of map.entries()) {
    groups.push({
      date,
      naturalDate: formatNaturalDate(date, zh, now),
      latest: items[0],
      earlier: items.slice(1),
    });
  }

  return groups;
}
