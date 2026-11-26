import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DbClient } from '../db/client.js';
import { getAppConfig } from '../config.js';
import type {
  AppUpdateAdminConfig,
  AppUpdateCheckResponse,
  AppUpdateReleaseInfo,
  AppUpdateSyncResult,
} from '../../shared/types.js';

const CONFIG_KEY = 'android_update_config';
const STATE_KEY = 'android_update_latest';
const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface StoredUpdateConfig {
  githubRepo?: string;
  githubToken?: string;
  enabled?: boolean;
  pollIntervalMinutes?: number;
  forceUpdateMinVersion?: string;
}

interface StoredUpdateState {
  latest: AppUpdateReleaseInfo | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface GitHubAsset {
  id?: number;
  name?: string;
  url?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubAsset[];
}

export type AppUpdateEventListener = (release: AppUpdateReleaseInfo) => void;

const subscribers = new Set<AppUpdateEventListener>();
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight: Promise<AppUpdateSyncResult> | null = null;

export function subscribeAppUpdateEvents(listener: AppUpdateEventListener): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getConnectedUpdateClientCount(): number {
  return subscribers.size;
}

export function broadcastAppUpdate(release: AppUpdateReleaseInfo): number {
  let delivered = 0;
  for (const listener of Array.from(subscribers)) {
    try {
      listener(release);
      delivered += 1;
    } catch {
      subscribers.delete(listener);
    }
  }
  return delivered;
}

export function normalizeVersionName(raw: string | undefined | null): string {
  const cleaned = String(raw || '').trim().replace(/^[vV]+/, '');
  return cleaned || '0.0.0';
}

export function compareSemver(a: string, b: string): number {
  const parseParts = (ver: string): number[] =>
    normalizeVersionName(ver)
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => {
        const m = /^(\d+)/.exec(part.trim());
        return m ? Number(m[1]) : 0;
      });

  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

export function parseVersionCode(releaseBody: string | undefined | null, versionName: string): number {
  const body = String(releaseBody || '');
  const match = /(?:versionCode|version_code|build)\s*[:=]\s*(\d+)/i.exec(body);
  if (match) {
    const explicit = Number(match[1]);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  const parts = normalizeVersionName(versionName)
    .split(/[-+]/)[0]
    .split('.')
    .map((p) => Number((/^(\d+)/.exec(p) || [])[1] ?? 0));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  const derived = major * 10000 + minor * 100 + patch;
  return derived > 0 ? derived : 1;
}

export function isReleaseNewer(
  latest: AppUpdateReleaseInfo | null,
  currentVersion: string,
  currentVersionCode: number
): boolean {
  if (!latest) return false;
  const normCurrent = String(currentVersion || '').trim();
  if (!normCurrent) {
    return currentVersionCode > 0 ? latest.versionCode > currentVersionCode : true;
  }
  const cmp = compareSemver(latest.versionName, normCurrent);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  return latest.versionCode > currentVersionCode;
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '');
  return cleaned || fallback;
}

export function getCacheDir(overrideDir?: string): string {
  const raw = overrideDir || getAppConfig().appUpdateCacheDir || './data/updates';
  return path.resolve(process.cwd(), raw);
}

export function resolveCachedApkPath(
  release: Pick<AppUpdateReleaseInfo, 'tagName' | 'fileName'>,
  overrideCacheDir?: string
): string | null {
  const root = getCacheDir(overrideCacheDir);
  const tagDir = sanitizeSegment(release.tagName, 'latest');
  const fileName = sanitizeSegment(release.fileName, 'prismq.apk');
  const resolved = path.resolve(root, tagDir, fileName);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function readSettingJson<T>(db: DbClient, key: string): Promise<T | null> {
  const res = await db.query<{ value: unknown }>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [key]
  );
  if (!res.rows[0]) return null;
  const raw = res.rows[0].value;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return (raw as T) ?? null;
}

async function writeSettingJson(db: DbClient, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

export async function getStoredUpdateConfig(db: DbClient): Promise<{
  githubRepo: string;
  githubToken: string;
  enabled: boolean;
  pollIntervalMinutes: number;
  forceUpdateMinVersion: string;
}> {
  const appCfg = getAppConfig();
  const stored = (await readSettingJson<StoredUpdateConfig>(db, CONFIG_KEY)) || {};
  const repoCandidate = (stored.githubRepo ?? appCfg.githubRepo ?? '').trim();
  const pollRaw = stored.pollIntervalMinutes ?? appCfg.appUpdatePollIntervalMinutes ?? 15;
  return {
    githubRepo: GITHUB_REPO_RE.test(repoCandidate) ? repoCandidate : '',
    githubToken: (stored.githubToken ?? appCfg.githubToken ?? '').trim(),
    enabled: stored.enabled !== undefined ? Boolean(stored.enabled) : true,
    pollIntervalMinutes: Math.max(1, Math.min(1440, Number(pollRaw) || 15)),
    forceUpdateMinVersion: (stored.forceUpdateMinVersion ?? '').trim(),
  };
}

export async function getAdminUpdateConfigView(db: DbClient): Promise<{
  config: AppUpdateAdminConfig;
  latest: AppUpdateReleaseInfo | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  connectedClients: number;
}> {
  const cfg = await getStoredUpdateConfig(db);
  const state = await getStoredUpdateState(db);
  return {
    config: {
      githubRepo: cfg.githubRepo,
      hasGithubToken: Boolean(cfg.githubToken),
      enabled: cfg.enabled,
      pollIntervalMinutes: cfg.pollIntervalMinutes,
      forceUpdateMinVersion: cfg.forceUpdateMinVersion,
    },
    latest: state.latest,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    connectedClients: subscribers.size,
  };
}

export async function updateAdminUpdateConfig(
  db: DbClient,
  patch: {
    githubRepo?: string;
    githubToken?: string;
    clearToken?: boolean;
    enabled?: boolean;
    pollIntervalMinutes?: number;
    forceUpdateMinVersion?: string;
  }
): Promise<AppUpdateAdminConfig> {
  const current = await getStoredUpdateConfig(db);
  let nextRepo = current.githubRepo;
  if (patch.githubRepo !== undefined) {
    const trimmed = patch.githubRepo.trim();
    if (!GITHUB_REPO_RE.test(trimmed)) {
      throw new Error('GitHub 仓库格式必须为 owner/repo');
    }
    nextRepo = trimmed;
  }

  let nextToken = current.githubToken;
  if (patch.clearToken) {
    nextToken = '';
  } else if (patch.githubToken !== undefined && patch.githubToken.trim()) {
    nextToken = patch.githubToken.trim();
  }

  const next: StoredUpdateConfig = {
    githubRepo: nextRepo,
    githubToken: nextToken,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    pollIntervalMinutes:
      patch.pollIntervalMinutes !== undefined
        ? Math.max(1, Math.min(1440, Math.round(Number(patch.pollIntervalMinutes) || 15)))
        : current.pollIntervalMinutes,
    forceUpdateMinVersion:
      patch.forceUpdateMinVersion !== undefined
        ? patch.forceUpdateMinVersion.trim()
        : current.forceUpdateMinVersion,
  };
  await writeSettingJson(db, CONFIG_KEY, next);
  return {
    githubRepo: nextRepo,
    hasGithubToken: Boolean(nextToken),
    enabled: Boolean(next.enabled),
    pollIntervalMinutes: next.pollIntervalMinutes || 15,
    forceUpdateMinVersion: next.forceUpdateMinVersion || '',
  };
}

export async function getStoredUpdateState(db: DbClient): Promise<StoredUpdateState> {
  const state = await readSettingJson<StoredUpdateState>(db, STATE_KEY);
  return {
    latest: state?.latest ?? null,
    lastCheckedAt: state?.lastCheckedAt ?? null,
    lastError: state?.lastError ?? null,
  };
}

export async function buildUpdateCheckResponse(
  db: DbClient,
  currentVersion: string,
  currentVersionCode: number,
  overrideCacheDir?: string
): Promise<AppUpdateCheckResponse> {
  const [cfg, state] = await Promise.all([
    getStoredUpdateConfig(db),
    getStoredUpdateState(db),
  ]);
  const cachedFileExists = state.latest
    ? Boolean((() => {
        const p = resolveCachedApkPath(state.latest, overrideCacheDir);
        return p && fs.existsSync(p);
      })())
    : false;

  const latestRaw = state.latest && cachedFileExists ? state.latest : null;
  const forceByMinVersion =
    Boolean(latestRaw && cfg.forceUpdateMinVersion && currentVersion) &&
    compareSemver(currentVersion, cfg.forceUpdateMinVersion) < 0;
  const latest = latestRaw
    ? {
        ...latestRaw,
        downloadUrl: '/api/app-update/download',
        forceUpdate: Boolean(latestRaw.forceUpdate || forceByMinVersion),
      }
    : null;

  return {
    hasUpdate: isReleaseNewer(latest, currentVersion, currentVersionCode),
    currentVersion,
    currentVersionCode,
    latest,
    lastCheckedAt: state.lastCheckedAt,
  };
}

function selectApkAsset(assets: GitHubAsset[] | undefined): GitHubAsset | null {
  if (!Array.isArray(assets)) return null;
  const apks = assets.filter((a) => (a.name || '').toLowerCase().endsWith('.apk'));
  if (apks.length === 0) return null;
  const preferred = apks.find((a) => (a.name || '').toLowerCase().includes('prismq'));
  return preferred || apks[0];
}

async function downloadGitHubAssetBuffer(
  assetUrl: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  let currentUrl = assetUrl;
  const initialHost = new URL(assetUrl).host;

  for (let hop = 0; hop < 5; hop += 1) {
    const parsedHost = new URL(currentUrl).host;
    const headers: Record<string, string> = {
      'User-Agent': 'PrismQ-Server/1.0',
      Accept: hop === 0 ? 'application/octet-stream' : '*/*',
    };
    // Only forward GitHub Authorization on the GitHub API origin, never to signed S3/Azure redirect URLs.
    if (token && parsedHost === initialHost) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchImpl(currentUrl, {
      headers,
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`下载 APK 重定向缺少 Location 头 (${res.status})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      const snippet = await res.text().catch(() => '');
      throw new Error(`下载 APK 失败 (${res.status}): ${snippet.slice(0, 160)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  throw new Error('下载 APK 重定向次数过多');
}

function pruneOldCacheDirs(cacheRoot: string, keepTagDir: string): void {
  try {
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && e.name !== keepTagDir)
      .map((e) => {
        const full = path.join(cacheRoot, e.name);
        return { name: e.name, full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of dirs.slice(1)) {
      fs.rmSync(stale.full, { recursive: true, force: true });
    }
  } catch {
    // ignore cache cleanup failures
  }
}

export async function publishUploadedApk(
  db: DbClient,
  params: {
    buffer: Buffer;
    originalFileName: string;
    versionName?: string;
    versionCode?: number;
    releaseNotes?: string;
    forceUpdate?: boolean;
    cacheDir?: string;
  }
): Promise<AppUpdateSyncResult> {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('上传的 APK 文件不能为空');
  }
  const origName = String(params.originalFileName || 'prismq.apk').trim();
  if (!origName.toLowerCase().endsWith('.apk')) {
    throw new Error('仅支持上传 .apk 安装包文件');
  }
  if (
    params.buffer.length < 4 ||
    params.buffer[0] !== 0x50 ||
    params.buffer[1] !== 0x4b ||
    params.buffer[2] !== 0x03 ||
    params.buffer[3] !== 0x04
  ) {
    throw new Error('APK 文件格式校验失败，请确认上传完整的 Android 安装包');
  }

  const nameMatch = /v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/i.exec(origName);
  const rawVer = String(params.versionName || '').trim() || (nameMatch ? nameMatch[1] : '');
  if (!rawVer || !/\d+\.\d+/.test(rawVer)) {
    throw new Error('请填写版本号（如 2.4.4）或确保文件名包含版本号（如 prismq-v2.4.4.apk）');
  }

  const versionName = normalizeVersionName(rawVer);
  const tagName = `v${versionName}`;
  const notes = String(params.releaseNotes || '').trim();
  const explicitCode = Number(params.versionCode || 0);
  const versionCode =
    Number.isFinite(explicitCode) && explicitCode > 0
      ? Math.floor(explicitCode)
      : parseVersionCode(notes, versionName);
  const forceUpdate = Boolean(params.forceUpdate);
  const checkedAt = new Date().toISOString();

  const safeTagDir = sanitizeSegment(tagName, 'latest');
  const safeFileName = sanitizeSegment(origName, `prismq-${versionName}.apk`);
  const cacheRoot = getCacheDir(params.cacheDir);
  const targetDir = path.join(cacheRoot, safeTagDir);
  const targetFile = path.join(targetDir, safeFileName);
  const tmpFile = `${targetFile}.tmp-${Date.now()}`;

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(tmpFile, params.buffer);
  fs.renameSync(tmpFile, targetFile);

  const metaPayload = {
    versionName,
    versionCode,
    tagName,
    releaseNotes: notes || `PrismQ Android v${versionName}`,
    forceUpdate,
    publishedAt: checkedAt,
    fileName: safeFileName,
  };
  fs.writeFileSync(path.join(targetDir, 'release.json'), JSON.stringify(metaPayload, null, 2));
  pruneOldCacheDirs(cacheRoot, safeTagDir);

  const fileSize = params.buffer.length;
  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const latest: AppUpdateReleaseInfo = {
    versionName,
    versionCode,
    tagName,
    releaseNotes: metaPayload.releaseNotes,
    publishedAt: checkedAt,
    fileName: safeFileName,
    fileSize,
    sha256,
    downloadUrl: '/api/app-update/download',
    forceUpdate,
    syncedAt: checkedAt,
  };

  await writeSettingJson(db, STATE_KEY, {
    latest,
    lastCheckedAt: checkedAt,
    lastError: null,
  });

  const pushedClients = broadcastAppUpdate(latest);
  return {
    ok: true,
    updated: true,
    pushedClients,
    latest,
  };
}

interface LocalReleaseCandidate {
  filePath: string;
  dirPath: string;
  inRoot: boolean;
  fileName: string;
  versionName: string;
  versionCode: number;
  tagName: string;
  releaseNotes: string;
  forceUpdate: boolean;
  publishedAt: string;
  mtimeMs: number;
}

function parseLocalReleaseCandidate(
  filePath: string,
  dirPath: string,
  inRoot: boolean,
  fileName: string,
  parentDirName: string
): LocalReleaseCandidate | null {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) return null;

  let meta: Record<string, unknown> = {};
  const metaPath = path.join(dirPath, 'release.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object') {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid release.json
    }
  }

  const fromMeta = String(meta.versionName || '').trim();
  const fromFile = /v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/i.exec(fileName)?.[1] ?? '';
  const fromParent = inRoot
    ? ''
    : /v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/i.exec(parentDirName)?.[1] ?? '';
  const rawVer = fromMeta || fromFile || fromParent;
  if (!rawVer) return null;

  const versionName = normalizeVersionName(rawVer);
  const tagName = String(meta.tagName || '').trim() || `v${versionName}`;
  const releaseNotes = String(meta.releaseNotes || '').trim() || `PrismQ Android v${versionName}`;
  const metaCode = Number(meta.versionCode || 0);
  const versionCode =
    Number.isFinite(metaCode) && metaCode > 0
      ? Math.floor(metaCode)
      : parseVersionCode(releaseNotes, versionName);

  return {
    filePath,
    dirPath,
    inRoot,
    fileName,
    versionName,
    versionCode,
    tagName,
    releaseNotes,
    forceUpdate: Boolean(meta.forceUpdate),
    publishedAt: String(meta.publishedAt || new Date(stat.mtimeMs).toISOString()),
    mtimeMs: stat.mtimeMs,
  };
}

export async function scanLocalApkReleases(
  db: DbClient,
  opts?: {
    forcePush?: boolean;
    cacheDir?: string;
  }
): Promise<AppUpdateSyncResult> {
  if (syncInFlight) {
    return syncInFlight;
  }

  const run = async (): Promise<AppUpdateSyncResult> => {
    const checkedAt = new Date().toISOString();
    const prevState = await getStoredUpdateState(db);
    const cacheRoot = getCacheDir(opts?.cacheDir);

    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
      const candidates: LocalReleaseCandidate[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(cacheRoot, entry.name);
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk') && !entry.name.includes('.tmp-')) {
          const item = parseLocalReleaseCandidate(fullPath, cacheRoot, true, entry.name, '');
          if (item) candidates.push(item);
        } else if (entry.isDirectory()) {
          const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (
              sub.isFile() &&
              sub.name.toLowerCase().endsWith('.apk') &&
              !sub.name.includes('.tmp-')
            ) {
              const subPath = path.join(fullPath, sub.name);
              const item = parseLocalReleaseCandidate(subPath, fullPath, false, sub.name, entry.name);
              if (item) candidates.push(item);
            }
          }
        }
      }

      if (candidates.length === 0) {
        const cachedStillExists = prevState.latest
          ? Boolean((() => {
              const p = resolveCachedApkPath(prevState.latest, opts?.cacheDir);
              return p && fs.existsSync(p);
            })())
          : false;
        const retained = cachedStillExists ? prevState.latest : null;
        await writeSettingJson(db, STATE_KEY, {
          latest: retained,
          lastCheckedAt: checkedAt,
          lastError: null,
        });
        return {
          ok: true,
          updated: false,
          pushedClients: 0,
          latest: retained,
        };
      }

      candidates.sort((a, b) => {
        const cmp = compareSemver(b.versionName, a.versionName);
        if (cmp !== 0) return cmp;
        if (b.versionCode !== a.versionCode) return b.versionCode - a.versionCode;
        return b.mtimeMs - a.mtimeMs;
      });
      const chosen = candidates[0];

      const safeTagDir = sanitizeSegment(chosen.tagName, 'latest');
      const safeFileName = sanitizeSegment(chosen.fileName, `prismq-${chosen.versionName}.apk`);
      const targetDir = path.join(cacheRoot, safeTagDir);
      const targetFile = path.join(targetDir, safeFileName);
      if (path.resolve(chosen.filePath) !== path.resolve(targetFile)) {
        fs.mkdirSync(targetDir, { recursive: true });
        if (chosen.inRoot) {
          fs.renameSync(chosen.filePath, targetFile);
        } else {
          fs.copyFileSync(chosen.filePath, targetFile);
        }
        fs.writeFileSync(
          path.join(targetDir, 'release.json'),
          JSON.stringify(
            {
              versionName: chosen.versionName,
              versionCode: chosen.versionCode,
              tagName: chosen.tagName,
              releaseNotes: chosen.releaseNotes,
              forceUpdate: chosen.forceUpdate,
              publishedAt: chosen.publishedAt,
              fileName: safeFileName,
            },
            null,
            2
          )
        );
      }

      const fileBuf = fs.readFileSync(targetFile);
      const fileSize = fileBuf.length;
      const sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

      const latest: AppUpdateReleaseInfo = {
        versionName: chosen.versionName,
        versionCode: chosen.versionCode,
        tagName: chosen.tagName,
        releaseNotes: chosen.releaseNotes,
        publishedAt: chosen.publishedAt,
        fileName: safeFileName,
        fileSize,
        sha256,
        downloadUrl: '/api/app-update/download',
        forceUpdate: chosen.forceUpdate,
        syncedAt: checkedAt,
      };

      const prevRelease = prevState.latest;
      const isNewerThanPrev =
        !prevRelease ||
        compareSemver(latest.versionName, prevRelease.versionName) > 0 ||
        (compareSemver(latest.versionName, prevRelease.versionName) === 0 &&
          latest.versionCode > prevRelease.versionCode) ||
        latest.sha256 !== prevRelease.sha256;

      await writeSettingJson(db, STATE_KEY, {
        latest,
        lastCheckedAt: checkedAt,
        lastError: null,
      });

      const pushedClients = isNewerThanPrev || opts?.forcePush ? broadcastAppUpdate(latest) : 0;
      return {
        ok: true,
        updated: Boolean(isNewerThanPrev),
        pushedClients,
        latest,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '扫描服务器 APK 目录失败';
      await writeSettingJson(db, STATE_KEY, {
        latest: prevState.latest,
        lastCheckedAt: checkedAt,
        lastError: errMsg,
      }).catch(() => {});
      return {
        ok: false,
        updated: false,
        pushedClients: 0,
        latest: prevState.latest,
        error: errMsg,
      };
    }
  };

  syncInFlight = run().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function syncLatestApkFromGitHub(
  db: DbClient,
  opts?: {
    forcePush?: boolean;
    fetchImpl?: typeof fetch;
    cacheDir?: string;
  }
): Promise<AppUpdateSyncResult> {
  if (syncInFlight) {
    return syncInFlight;
  }

  const run = async (): Promise<AppUpdateSyncResult> => {
    const checkedAt = new Date().toISOString();
    const cfg = await getStoredUpdateConfig(db);
    const prevState = await getStoredUpdateState(db);
    const fetchImpl = opts?.fetchImpl ?? fetch;

    if (!cfg.enabled && !opts?.forcePush) {
      return {
        ok: true,
        updated: false,
        pushedClients: 0,
        latest: prevState.latest,
      };
    }

    try {
      const apiUrl = `https://api.github.com/repos/${cfg.githubRepo}/releases/latest`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'PrismQ-Server/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (cfg.githubToken) {
        headers.Authorization = `Bearer ${cfg.githubToken}`;
      }

      const releaseRes = await fetchImpl(apiUrl, { headers });
      if (releaseRes.status === 404) {
        const errMsg = `GitHub 仓库 ${cfg.githubRepo} 暂无已发布的 Release（或私有仓库未配置 Token）`;
        await writeSettingJson(db, STATE_KEY, {
          latest: prevState.latest,
          lastCheckedAt: checkedAt,
          lastError: errMsg,
        });
        return {
          ok: false,
          updated: false,
          pushedClients: 0,
          latest: prevState.latest,
          error: errMsg,
        };
      }

      if (!releaseRes.ok) {
        const bodyText = await releaseRes.text().catch(() => '');
        throw new Error(`GitHub Release 查询失败 (${releaseRes.status}): ${bodyText.slice(0, 180)}`);
      }

      const payload = (await releaseRes.json()) as GitHubReleasePayload;
      const tagName = String(payload.tag_name || '').trim();
      if (!tagName) {
        throw new Error('GitHub Release 缺少 tag_name');
      }

      const asset = selectApkAsset(payload.assets);
      if (!asset || (!asset.url && !asset.browser_download_url)) {
        throw new Error(`Release ${tagName} 中未找到 .apk 安装包附件`);
      }

      const versionName = normalizeVersionName(tagName);
      const versionCode = parseVersionCode(payload.body, versionName);
      const safeTagDir = sanitizeSegment(tagName, 'latest');
      const safeFileName = sanitizeSegment(asset.name || `prismq-${versionName}.apk`, 'prismq.apk');
      const cacheRoot = getCacheDir(opts?.cacheDir);
      const targetDir = path.join(cacheRoot, safeTagDir);
      const targetFile = path.join(targetDir, safeFileName);
      const tmpFile = `${targetFile}.tmp-${Date.now()}`;

      const prevRelease = prevState.latest;
      const sameTagCached =
        prevRelease &&
        prevRelease.tagName === tagName &&
        prevRelease.fileName === safeFileName &&
        prevRelease.versionCode === versionCode &&
        fs.existsSync(targetFile);

      let fileSize = prevRelease?.fileSize ?? 0;
      let sha256 = prevRelease?.sha256 ?? '';

      if (!sameTagCached) {
        const downloadTarget = asset.url || asset.browser_download_url!;
        const apkBuffer = await downloadGitHubAssetBuffer(downloadTarget, cfg.githubToken, fetchImpl);
        if (apkBuffer.length === 0) {
          throw new Error('下载到的 APK 文件为空');
        }
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(tmpFile, apkBuffer);
        fs.renameSync(tmpFile, targetFile);
        fileSize = apkBuffer.length;
        sha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');
        pruneOldCacheDirs(cacheRoot, safeTagDir);
      }

      const forceInNotes = /\[force\]|forceUpdate\s*:\s*true/i.test(payload.body || '');
      const latest: AppUpdateReleaseInfo = {
        versionName,
        versionCode,
        tagName,
        releaseNotes: String(payload.body || payload.name || '').trim(),
        publishedAt: String(payload.published_at || checkedAt),
        fileName: safeFileName,
        fileSize,
        sha256,
        downloadUrl: '/api/app-update/download',
        forceUpdate: forceInNotes,
        syncedAt: sameTagCached && prevRelease ? prevRelease.syncedAt : checkedAt,
      };

      const isNewerThanPrev =
        !prevRelease ||
        compareSemver(latest.versionName, prevRelease.versionName) > 0 ||
        (compareSemver(latest.versionName, prevRelease.versionName) === 0 &&
          latest.versionCode > prevRelease.versionCode) ||
        latest.sha256 !== prevRelease.sha256;

      await writeSettingJson(db, STATE_KEY, {
        latest,
        lastCheckedAt: checkedAt,
        lastError: null,
      });

      const shouldBroadcast = Boolean(isNewerThanPrev || opts?.forcePush);
      const pushedClients = shouldBroadcast ? broadcastAppUpdate(latest) : 0;

      return {
        ok: true,
        updated: Boolean(isNewerThanPrev),
        pushedClients,
        latest,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'GitHub 同步失败';
      await writeSettingJson(db, STATE_KEY, {
        latest: prevState.latest,
        lastCheckedAt: checkedAt,
        lastError: errMsg,
      }).catch(() => {});
      return {
        ok: false,
        updated: false,
        pushedClients: 0,
        latest: prevState.latest,
        error: errMsg,
      };
    }
  };

  syncInFlight = run().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export function startAppUpdatePoller(db: DbClient): void {
  stopAppUpdatePoller();
  const cfg = getAppConfig();
  const intervalMinutes = Math.max(1, cfg.appUpdatePollIntervalMinutes || 15);
  const initialDelay = setTimeout(() => {
    void scanLocalApkReleases(db).catch((err) => {
      console.warn('[棱题 · PrismQ] 服务器本地 APK 初始扫描失败:', err instanceof Error ? err.message : err);
    });
  }, 3000);
  if (typeof initialDelay.unref === 'function') initialDelay.unref();

  pollerTimer = setInterval(() => {
    void scanLocalApkReleases(db).catch((err) => {
      console.warn('[棱题 · PrismQ] 服务器本地 APK 定时扫描失败:', err instanceof Error ? err.message : err);
    });
  }, intervalMinutes * 60 * 1000);
  if (typeof pollerTimer.unref === 'function') pollerTimer.unref();
}

export function stopAppUpdatePoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}
