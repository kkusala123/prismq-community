import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { fixMulterFilename } from './import.js';
import {
  buildUpdateCheckResponse,
  getAdminUpdateConfigView,
  getStoredUpdateState,
  isReleaseNewer,
  publishUploadedApk,
  resolveCachedApkPath,
  scanLocalApkReleases,
  subscribeAppUpdateEvents,
  updateAdminUpdateConfig,
} from '../services/appUpdate.js';

const apkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export function createAppUpdateRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthMiddlewares(db);

  // 客户端检查更新（公开接口，无需登录即可检查版本）
  router.get('/latest', async (req, res) => {
    try {
      const currentVersion = String(req.query.currentVersion || '').trim();
      const currentVersionCode = Math.max(0, Number(req.query.currentVersionCode || 0) || 0);
      const data = await buildUpdateCheckResponse(db, currentVersion, currentVersionCode);
      res.json(data);
    } catch (err) {
      console.error('[app-update latest]', err);
      res.status(500).json({ error: '检查应用更新失败' });
    }
  });

  // 客户端实时更新推送 SSE 长连接
  router.get('/stream', async (req, res) => {
    const currentVersion = String(req.query.currentVersion || '').trim();
    const currentVersionCode = Math.max(0, Number(req.query.currentVersionCode || 0) || 0);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const writeEvent = (eventName: string, payload: unknown) => {
      if (closed) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent('connected', {
      ok: true,
      currentVersion,
      currentVersionCode,
      timestamp: new Date().toISOString(),
    });

    try {
      const check = await buildUpdateCheckResponse(db, currentVersion, currentVersionCode);
      if (check.hasUpdate && check.latest) {
        writeEvent('update', check.latest);
      }
    } catch {
      // ignore initial check errors on stream connect
    }

    const unsubscribe = subscribeAppUpdateEvents((release) => {
      if (isReleaseNewer(release, currentVersion, currentVersionCode)) {
        writeEvent('update', release);
      }
    });

    const keepaliveTimer = setInterval(() => {
      if (!closed) {
        res.write(`: keepalive ${Date.now()}\n\n`);
      }
    }, 25000);
    if (typeof keepaliveTimer.unref === 'function') keepaliveTimer.unref();

    req.on('close', () => {
      closed = true;
      clearInterval(keepaliveTimer);
      unsubscribe();
    });
  });

  // 从服务端本地缓存下载最新 APK 安装包
  router.get('/download', async (_req, res) => {
    try {
      const state = await getStoredUpdateState(db);
      if (!state.latest) {
        res.status(404).json({ error: '服务端尚未缓存任何 APK 更新包' });
        return;
      }
      const apkPath = resolveCachedApkPath(state.latest);
      if (!apkPath || !fs.existsSync(apkPath)) {
        res.status(404).json({ error: '服务端尚未上传 APK 安装包，请管理员在后台上传或放入服务器 updates 目录' });
        return;
      }

      const stat = fs.statSync(apkPath);
      const encodedName = encodeURIComponent(state.latest.fileName || 'prismq.apk');
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.setHeader('X-APK-Version', state.latest.versionName);
      res.setHeader('X-APK-SHA256', state.latest.sha256);

      const stream = fs.createReadStream(apkPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: '读取 APK 安装包失败' });
        }
      });
      stream.pipe(res);
    } catch (err) {
      console.error('[app-update download]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '下载 APK 安装包失败' });
      }
    }
  });

  // 管理员：查看更新推送配置与缓存状态
  router.get('/admin/config', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const data = await getAdminUpdateConfigView(db);
      res.json(data);
    } catch (err) {
      console.error('[app-update admin get]', err);
      res.status(500).json({ error: '读取更新推送配置失败' });
    }
  });

  // 管理员：更新 GitHub 仓库/Token 与自动轮询策略
  router.put('/admin/config', requireAuth, requireAdmin, async (req, res) => {
    try {
      const body = req.body as {
        githubRepo?: string;
        githubToken?: string;
        clearToken?: boolean;
        enabled?: boolean;
        pollIntervalMinutes?: number;
        forceUpdateMinVersion?: string;
      };
      const config = await updateAdminUpdateConfig(db, body || {});
      res.json({ ok: true, config });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : '保存更新配置失败' });
    }
  });

  // 管理员：直接上传 APK 安装包到服务器并即时推送到所有在线客户端
  router.post(
    '/admin/upload',
    requireAuth,
    requireAdmin,
    apkUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: '请选择要上传的 .apk 安装包文件' });
          return;
        }
        const originalFileName = fixMulterFilename(req.file.originalname);
        const result = await publishUploadedApk(db, {
          buffer: req.file.buffer,
          originalFileName,
          versionName: req.body?.versionName ? String(req.body.versionName) : undefined,
          versionCode: req.body?.versionCode ? Number(req.body.versionCode) : undefined,
          releaseNotes: req.body?.releaseNotes ? String(req.body.releaseNotes) : undefined,
          forceUpdate: String(req.body?.forceUpdate || '') === 'true',
        });
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : '上传 APK 安装包失败' });
      }
    }
  );

  // 管理员：扫描服务器本地 updates 目录并立即向在线客户端推送更新通知
  router.post('/admin/sync', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await scanLocalApkReleases(db, { forcePush: true });
      if (!result.ok) {
        res.status(500).json({
          ok: false,
          error: result.error || '扫描服务器安装包失败',
          latest: result.latest,
        });
        return;
      }
      res.json(result);
    } catch (err) {
      console.error('[app-update admin sync]', err);
      res.status(500).json({ error: err instanceof Error ? err.message : '扫描服务器安装包失败' });
    }
  });

  return router;
}
