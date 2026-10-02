export type ExternalFeedErrorCode = 'invalid-url' | 'invalid-format' | 'too-many-repositories'
  | 'too-large' | 'unreadable' | 'http' | 'no-repositories' | 'no-details';

const messages: Record<ExternalFeedErrorCode, string> = {
  'invalid-url': 'A feed must use a public HTTPS URL without credentials.',
  'invalid-format': 'The feed format or a repository link is invalid.',
  'too-many-repositories': 'A JSON feed may contain at most 30 repositories.',
  'too-large': 'The feed exceeds 128000 bytes.',
  unreadable: 'Could not read the feed. Check its URL and browser CORS permissions.',
  http: 'The feed request failed or was redirected.',
  'no-repositories': 'No GitHub repository links were found in the feed.',
  'no-details': 'None of the feed repositories could be loaded from GitHub.',
};

export class ExternalFeedError extends Error {
  constructor(public readonly code: ExternalFeedErrorCode) {
    super(messages[code]);
    this.name = 'ExternalFeedError';
  }
}
