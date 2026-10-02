import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MarkdownRenderer from '../src/components/MarkdownRenderer';
import { backend } from '../src/services/backendAdapter';
import { desktopDavFetch } from '../src/services/electronProxy';
import { WebDAVService } from '../src/services/webdavService';
import { extractInertRssHtml } from '../src/utils/inertRssHtml';

const root = createRoot(document.getElementById('root')!);
Object.assign(window, {
  davFixture: {
    desktopDavFetch,
    service: (url: string) => new WebDAVService({
      id: 'unsaved-fixture', name: 'Fixture', url, username: 'inline-fixture',
      password: 'not-a-real-secret', path: '/dav', isActive: true,
    }),
    health: async (url?: string) => { await backend.init(url); return backend.isAvailable; },
    extract: extractInertRssHtml,
    render: (content: string) => flushSync(() => root.render(
      <MarkdownRenderer content={content} enableHtml baseUrl="https://github.com/fixture/repo/issues/1" />
    )),
  },
});
