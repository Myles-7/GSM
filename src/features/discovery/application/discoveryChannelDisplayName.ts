import { discoveryChannelName } from '../../../i18n/discoveryNames';
import type { AppLanguage } from '../../../i18n/languages';

export function discoveryChannelDisplayName(
  channel: { id: string; name: string; nameEn?: string }, language: AppLanguage,
): string {
  // External IDs contain i18next's namespace separator; their names are user data.
  return channel.id.startsWith('external:') ? channel.name : discoveryChannelName(channel, language);
}
