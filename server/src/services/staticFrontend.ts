import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Authorize only the inline bootstrap scripts in the deployed, trusted build. */
export function staticFrontendScriptHashes(staticDir = process.env.STATIC_DIR): string[] {
  if (!staticDir) return [];
  const indexFile = path.resolve(staticDir, 'index.html');
  if (!fs.existsSync(indexFile)) return [];
  const html = fs.readFileSync(indexFile, 'utf8');
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(match => match[1])
    .filter(script => script.trim())
    .map(script => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  return [...new Set(hashes)];
}

const backendPathPrefixes = ['/api', '/mcp', '/sse', '/messages'];

/** Returns true when a URL belongs to an API, MCP, or SSE endpoint namespace. */
function isBackendPath(requestPath: string): boolean {
  return backendPathPrefixes.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

/**
 * Optionally serves a compiled frontend from the directory configured by STATIC_DIR.
 *
 * The standalone backend image intentionally does not set STATIC_DIR, so its routes
 * and 404 behavior remain unchanged. The full-stack image sets STATIC_DIR=/app/public.
 */
export function mountStaticFrontend(app: Express, staticDir = process.env.STATIC_DIR): boolean {
  if (!staticDir) {
    return false;
  }

  const resolvedStaticDir = path.resolve(staticDir);
  const indexFile = path.join(resolvedStaticDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return false;
  }

  const serveStatic = express.static(resolvedStaticDir, { index: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isBackendPath(req.path)) {
      next();
      return;
    }

    serveStatic(req, res, next);
  });

  // Register this after all API and MCP routes. Keep their unknown paths as 404s
  // instead of returning the SPA shell.
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (isBackendPath(req.path) || path.extname(req.path) || !req.accepts('html')) {
      next();
      return;
    }

    res.sendFile(indexFile, (error) => {
      if (error) {
        next(error);
      }
    });
  });

  return true;
}
