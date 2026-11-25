import { Router } from 'express';
import multer from 'multer';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import {
  computeStemFingerprint,
  formatDraftsToCanonicalText,
  STANDARD_QUESTION_BANK_JSON_SCHEMA,
  validateDraftBatch,
} from '../../shared/questionSchema.js';
import {
  extractRawTextFromUpload,
  generateImportTemplateDocx,
  generateImportTemplateWorkbook,
  parseStructuredText,
  parseUploadedFile,
} from '../services/parser.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

export function fixMulterFilename(rawName: string): string {
  try {
    const converted = Buffer.from(rawName, 'latin1').toString('utf8');
    if (!converted.includes('\uFFFD')) {
      return converted;
    }
  } catch {
    // keep raw
  }
  return rawName;
}

export async function loadBankStemFingerprints(
  db: DbClient,
  bankId: string,
  userId: string,
  role: string
): Promise<Set<string>> {
  if (!bankId) return new Set();
  const { rows } = await db.query<{ stem: string }>(
    `SELECT q.stem
     FROM questions q
     JOIN question_banks b ON b.id = q.bank_id
     WHERE q.bank_id = $1 AND (
       b.owner_id = $2
       OR b.visibility = 'public'
       OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
       OR $3 = 'admin'
     )`,
    [bankId, userId, role]
  );
  return new Set(rows.map((r) => computeStemFingerprint(r.stem)).filter((fp) => fp.length >= 4));
}

export function createImportRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddlewares(db);

  router.get('/schema.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(STANDARD_QUESTION_BANK_JSON_SCHEMA);
  });

  router.get('/template', (_req, res) => {
    try {
      const buffer = generateImportTemplateWorkbook();
      const filename = encodeURIComponent('棱题PrismQ_标准导题模板.xlsx');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buffer);
    } catch (err) {
      console.error('[download template]', err);
      res.status(500).json({ error: '生成导题模板失败' });
    }
  });

  router.get('/template-word', (_req, res) => {
    try {
      const buffer = generateImportTemplateDocx();
      const filename = encodeURIComponent('棱题PrismQ_标准导题模板.docx');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buffer);
    } catch (err) {
      console.error('[download word template]', err);
      res.status(500).json({ error: '生成 Word 导题模板失败' });
    }
  });

  // 提取原始文本或直接结构化解析（表格 / JSON / 标准 Word 文档直接解析并校验）
  router.post('/extract-raw', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: '请先选择需要导入的题库文件' });
        return;
      }
      const originalName = fixMulterFilename(req.file.originalname);
      const lower = originalName.toLowerCase();
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const bankId = String(req.body?.bankId ?? '').trim();

      if (
        lower.endsWith('.xlsx') ||
        lower.endsWith('.xls') ||
        lower.endsWith('.csv') ||
        lower.endsWith('.json') ||
        lower.endsWith('.docx')
      ) {
        const parsed = await parseUploadedFile(req.file.buffer, originalName, defaultChapter);
        const existingFps = await loadBankStemFingerprints(
          db,
          bankId,
          req.user!.userId,
          req.user!.role
        );
        const validated = validateDraftBatch(parsed.drafts, existingFps);

        if (!lower.endsWith('.docx') || validated.drafts.length > 0) {
          res.json({
            mode: 'structured',
            sourceFormat: parsed.sourceFormat,
            filename: originalName,
            count: validated.drafts.length,
            drafts: validated.drafts,
            summary: validated.summary,
            canonicalText: formatDraftsToCanonicalText(validated.drafts),
            rawText: parsed.rawTextPreview,
          });
          return;
        }
      }

      const rawText = await extractRawTextFromUpload(req.file.buffer, originalName);
      res.json({
        mode: 'text',
        sourceFormat: 'text',
        filename: originalName,
        rawText,
      });
    } catch (err) {
      console.error('[extract-raw]', err);
      res.status(400).json({
        error: err instanceof Error ? `文档提取失败: ${err.message}` : '文档提取失败',
      });
    }
  });

  router.post('/validate', requireAuth, async (req, res) => {
    try {
      const items = Array.isArray(req.body?.drafts) ? req.body.drafts : [];
      const bankId = String(req.body?.bankId ?? '').trim();
      const existingFps = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );
      const validated = validateDraftBatch(items, existingFps);
      res.json({
        drafts: validated.drafts,
        summary: validated.summary,
        canonicalText: formatDraftsToCanonicalText(validated.drafts),
      });
    } catch (err) {
      console.error('[validate drafts]', err);
      res.status(400).json({ error: '校验试题格式失败' });
    }
  });

  router.post('/parse-file', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: '请先选择需要导入的题库文件' });
        return;
      }
      const originalName = fixMulterFilename(req.file.originalname);
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const bankId = String(req.body?.bankId ?? '').trim();
      const parsed = await parseUploadedFile(req.file.buffer, originalName, defaultChapter);
      const existingFps = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );
      const validated = validateDraftBatch(parsed.drafts, existingFps);

      res.json({
        filename: originalName,
        sourceFormat: parsed.sourceFormat,
        count: validated.drafts.length,
        drafts: validated.drafts,
        summary: validated.summary,
        canonicalText: formatDraftsToCanonicalText(validated.drafts),
        rawTextPreview: parsed.rawTextPreview,
      });
    } catch (err) {
      console.error('[parse-file]', err);
      res.status(400).json({
        error: err instanceof Error ? `文件解析失败: ${err.message}` : '文件解析失败，请检查文件格式',
      });
    }
  });

  router.post('/parse-text', requireAuth, async (req, res) => {
    try {
      const text = String(req.body?.text ?? '');
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const bankId = String(req.body?.bankId ?? '').trim();
      if (!text.trim()) {
        res.status(400).json({ error: '请先粘贴需要解析的试题文本' });
        return;
      }
      const rawDrafts = parseStructuredText(text, defaultChapter);
      const existingFps = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );
      const validated = validateDraftBatch(rawDrafts, existingFps);

      res.json({
        count: validated.drafts.length,
        drafts: validated.drafts,
        summary: validated.summary,
        canonicalText: formatDraftsToCanonicalText(validated.drafts),
      });
    } catch (err) {
      console.error('[parse-text]', err);
      res.status(400).json({ error: '文本解析失败，请检查输入格式' });
    }
  });

  return router;
}
