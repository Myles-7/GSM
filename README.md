# GitHub Stars Manager — personal edition

A local-first GitHub library for syncing Stars, organizing repositories, searching, tracking releases, and evidence-based repository questions. Myles-7/GSM adds Chinese/English UI, Electron desktop integration, AGY CLI, dual classification, project exploration, and offline HTML reading.

[中文](README_zh.md) · [Documentation](docs/README.md) · [Architecture](docs/architecture.md)

The application version remains **0.8.4**, with selectively integrated upstream changes. This is not the complete upstream 0.8.5 release. Upstream installers and update feeds do not contain all personal features.

## Run from source

Use Node.js **22.12+**. CI uses Node 24 for the frontend and Node 22 for the SQLite server; prefer these LTS runtimes. Install native server dependencies with the same Node version and architecture used at runtime.

```sh
npm ci
npm run dev
```

Open Vite's localhost address and configure your GitHub token. AI, vector search, WebDAV, and download integrations are optional. Network features send selected content to configured providers; local storage does not imply offline processing.

```sh
npm run dev:desktop       # Electron + isolated Vite development server
npm run build             # Recompile frontend into dist/
npm run electron          # Open the built frontend
npm run build:desktop     # Build installer on Windows; never auto-publish
```

The existing Windows shortcut loads `dist/` through `scripts/start-home-desktop.cjs`. Source edits take effect there after rebuilding. See [Windows usage](开始使用.md).

## Optional backend

Express/SQLite provides synchronization, durable tasks, API proxies, encrypted server credentials, and MCP. Client storage and the server database are separate data stores.

```sh
npm ci --prefix server
npm --prefix server run dev
```

The server defaults to `127.0.0.1:3000`. Set `API_SECRET` before connecting clients; production refuses to start without it. See [environment variables](server/.env.example). Environment files are not loaded automatically: after building, use `node --env-file=/absolute/path/backend.env server/dist/index.js`. Restore databases together with their original encryption key.

[Docker](DOCKER.md) · [Windows service](docs/home-backend.md) · [Vector Worker](cloudflare-worker/README.md)

## Quality checks

```sh
npm run check             # lint, types, fixtures, boundaries, i18n, registry, docs
npm run test:run          # Frontend, Electron and launcher regression suites
npm --prefix server test
npm --prefix server run typecheck
npm run build:all
npm run format:check      # Whitespace errors in the working diff
```

There is no global formatter; avoid unrelated formatting churn. [Scripts](scripts/README.md) documents offline UI audits. Synthetic tests do not validate real GitHub/AI/SMTP credentials or phone behavior. Native Electron smoke tests and installers require a desktop environment.

## Maintenance

Views delegate remote work to feature hooks and services. Zustand owns application state; IndexedDB stores account-scoped durable data. Electron IPC checks the trusted main frame. Plugin pages use a capability bridge; native plugin Workers execute Node code and require trusted plugins.

Do not commit credentials, databases, local deployments, dependencies or generated builds/reports. Git stores source history, not application data. Ordinary branch pushes run CI without publishing releases. See [governance](docs/personal/repository-governance.md).

Licensed under [MIT](LICENSE). Based on [AmintaCCCP/GithubStarsManager](https://github.com/AmintaCCCP/GithubStarsManager).
