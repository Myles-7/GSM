import { Router } from 'express';
import { MCP_SERVER_VERSION } from '../mcp/version.js';

const router = Router();

router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: MCP_SERVER_VERSION,
    protocols: { sync: 2, tasks: 1 },
    timestamp: new Date().toISOString(),
  });
});

export default router;
