import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { getAppConfig } from './config.js';
import type { DbClient } from './db/client.js';
import {
  createCorsMiddleware,
  securityHeadersMiddleware,
} from './middleware/security.js';
import { createAuthRouter } from './routes/auth.js';
import { createBanksRouter } from './routes/banks.js';
import { createImportRouter } from './routes/import.js';
import { createPracticeRouter } from './routes/practice.js';
import { createExamsRouter } from './routes/exams.js';
import { createAiRouter } from './routes/ai.js';
import { createAdminRouter } from './routes/admin.js';
import { createAppUpdateRouter } from './routes/appUpdate.js';

export function createApp(db: DbClient): express.Express {
  const app = express();
  const cfg = getAppConfig();

  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(securityHeadersMiddleware);
  app.use(createCorsMiddleware(cfg));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1 AS ok');
      res.json({
        status: 'ok',
        dbEngine: db.engine,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        error: err instanceof Error ? err.message : 'db error',
      });
    }
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/banks', createBanksRouter(db));
  app.use('/api/import', createImportRouter(db));
  app.use('/api/practice', createPracticeRouter(db));
  app.use('/api/exams', createExamsRouter(db));
  app.use('/api/ai', createAiRouter(db));
  app.use('/api/admin', createAdminRouter(db));
  app.use('/api/app-update', createAppUpdateRouter(db));

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API 接口不存在' });
  });

  // 托管前端静态资源与 SPA 路由回退
  const clientDistDir = path.resolve(process.cwd(), 'dist/client');
  const publicDir = path.resolve(process.cwd(), 'public');
  const clientAssetsDir = path.join(clientDistDir, 'assets');

  if (fs.existsSync(clientAssetsDir)) {
    app.use('/assets', express.static(clientAssetsDir, { maxAge: '365d', immutable: true }));
  }

  const staticCacheHeaders = (res: express.Response, filePath: string) => {
    const baseName = path.basename(filePath).toLowerCase();
    if (baseName === 'index.html' || baseName === 'sw.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  };

  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir, { setHeaders: staticCacheHeaders }));
  }
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { setHeaders: staticCacheHeaders }));
  }

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    const indexHtml = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(indexHtml);
    } else {
      res.status(200).send('PrismQ (棱题) API Server is running. Build client via `npm run build` or run Vite dev server.');
    }
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: '上传文件过大，最大支持 30MB' });
        return;
      }
      res.status(400).json({ error: `文件上传失败：${err.message}` });
      return;
    }
    const errObj = err as { type?: string } | null;
    if (errObj?.type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求体 JSON 格式不正确' });
      return;
    }
    if (errObj?.type === 'entity.too.large') {
      res.status(413).json({ error: '请求数据过大，请拆分后重试' });
      return;
    }
    console.error(`[unhandled error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  };
  app.use(errorHandler);

  return app;
}
