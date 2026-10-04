import type { TranslateFn } from '../../i18n/useT';

export function translateReadingLabels<T extends string>(fields: Record<T, string>, group: 'card' | 'detail' | 'operation', t: TranslateFn): Record<T, string> {
  return Object.fromEntries(Object.keys(fields).map(key => [key, t(`htmlReadingLabels.${group}.${key}`)])) as Record<T, string>;
}
