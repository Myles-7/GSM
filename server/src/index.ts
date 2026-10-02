import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger, morganLoggerStream } from './services/logger.js';
import { mountStaticFrontend } from './services/staticFrontend.js';
import { getDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import healthRouter from './routes/health.js';
import repositoriesRouter from './routes/repositories.js';
import releasesRouter from './routes/releases.js';
import categoriesRouter from './routes/categories.js';
import configsRouter from './routes/configs.js';
import syncRouter from './routes/sync.js';
import authRestoreRouter from './routes/authRestore.js';
import proxyRouter from './routes/proxy.js';
import xtweetRouter from './routes/xtweet.js';
import telegramRouter from './routes/telegram.js';
import logsRouter from './routes/logs.js';
import mcpAdminRouter from './routes/mcp.js';
import { mountMcpRoutes } from './mcp/http.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import syncV2Router, { legacySyncV2Guard } from './routes/syncV2.js';
import tasksRouter from './routes/tasks.js';
import discoveryRouter from './routes/discovery.js';
import { initializeTasks, startTaskRunner, stopTaskRunner } from './services/taskRunner.js';
import { backupBeforeMigration, startBackupScheduler } from './services/backups.js';

// Origins the SPA is allowed to call directly from the browser. 'self' covers
// the backend proxy; the rest support the "browser direct" route mode
// (GitHub REST/gist APIs and the default AI provider endpoints). Deployments
// with custom AI/worker endpoints can extend this via CSP_CONNECT_SRC
// (comma-separated origins).
const BROWSER_CONNECT_ORIGINS = [
  'https://api.github.com',
  'https://raw.githubusercontent.com',
  'https://gist.githubusercontent.com',
  // Trending discovery fetches GitHubTrendingRSS directly from the browser.
  'https://mshibanami.github.io',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  // Personal whole-page translation uses the bundled translate.js Edge client.
  'https://edge.microsoft.com',
];

function buildConnectSrc(): string[] {
  const extra = (process.env.CSP_CONNECT_SRC ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return ["'self'", ...BROWSER_CONNECT_ORIGINS, ...extra];
}

export function createApp(): express.Express {
  const app = express();
  app.use((_req, res, next) => { res.setHeader('X-Request-ID', randomUUID()); next(); });

  // Helmet's default CSP blocks every browser-direct call (api.github.com,
  // avatar images, AI providers), which breaks the supported "browser direct"
  // route mode. Open connect-src/img-src just enough for those origins.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': buildConnectSrc(),
          'img-src': ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );
  app.use(
    cors({
      exposedHeaders: [
        'X-Request-ID',
        'X-Log-Count',
        'Mcp-Session-Id',
        'mcp-session-id',
        'Retry-After',
        'retry-after-ms',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'x-ratelimit-remaining',
      ],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-MCP-Token',
        'Mcp-Session-Id',
        'mcp-session-id',
        'Last-Event-ID',
      ],
    })
  );
  morgan.token('gsm-request-id', (_req, res) => String(res.getHeader('X-Request-ID') ?? ''));
  app.use(morgan(':gsm-request-id :method :url :status :response-time ms', { stream: morganLoggerStream }));
  app.use(express.json({ limit: '50mb' }));

  // Auth middleware for all /api/* except /api/health
  app.use('/api', authMiddleware);

  // Routes
  app.use(healthRouter);
  app.use(syncV2Router);
  app.use(tasksRouter);
  app.use(discoveryRouter);
  app.use(legacySyncV2Guard);

  // Wave 2: Data CRUD routes
  app.use(repositoriesRouter);
  app.use(releasesRouter);
  app.use(categoriesRouter);
  app.use(configsRouter);
  app.use(syncRouter);
  app.use(authRestoreRouter);

  // Wave 3: Proxy routes
  app.use(proxyRouter);
  app.use(xtweetRouter);
  app.use(telegramRouter);

  // Wave 4: Logs route
  app.use(logsRouter);

  // MCP admin API (protected by API_SECRET via /api middleware above)
  app.use(mcpAdminRouter);

  // MCP Streamable HTTP + legacy SSE (own token auth; not under /api)
  // Mount always; each request is gated on live SQLite settings (no write on mount).
  mountMcpRoutes(app);

  // Full-stack images opt in through STATIC_DIR. Standalone backend deployments
  // leave it unset, preserving the previous API-only behavior.
  mountStaticFrontend(app);

  // Global error handler
  app.use(errorHandler);

  return app;
}

async function startServer(): Promise<void> {
  // Initialize database
  const db = getDb();
  const backupDir = path.join(config.dataDir, 'backups');
  const hasExistingSchema = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  if (hasExistingSchema) {
    const version = (db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number }).version;
    if (version < 3) await backupBeforeMigration(db, backupDir);
  }
  runMigrations(db);
  initializeTasks(db);
  startTaskRunner(db);
  const stopBackups = startBackupScheduler(db, backupDir, error => logger.errorFromError('backup', 'Scheduled backup failed', error));
  logger.info('server.init', 'Database initialized');

  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    logger.info('server.start', `Server running on port ${config.port}`);
    if (!config.apiSecret) {
      logger.warn('server.auth', 'Running without API_SECRET — auth is disabled');
    }
  });

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logger.info('server.shutdown', 'Shutting down...');
    // Stop new submissions first, then settle task writes and online backups before closing SQLite.
    server.close();
    await stopTaskRunner();
    await stopBackups();
    server.closeAllConnections();
    closeDb();
    logger.info('server.shutdown', 'Server stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only start server when run directly (not imported for tests)
const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  void startServer().catch(error => { logger.errorFromError('server.start', 'Startup failed', error); closeDb(); process.exitCode = 1; });
}
