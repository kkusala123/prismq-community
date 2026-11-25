import type { DbClient } from '../db/client.js';
import { normalizeAndValidateDraft } from '../../shared/questionSchema.js';

export interface InvalidImportItem {
  index: number;
  stem: string;
  errors: string[];
}

export type BatchImportResult =
  | {
      ok: true;
      insertedCount: number;
      skippedCount: number;
    }
  | {
      ok: false;
      error: string;
      invalidItems?: InvalidImportItem[];
    };

/**
 * 批量校验并写入试题至指定题库（供 HTTP 路由与后台 AI 任务自动入库共同复用）
 */
export async function batchInsertQuestionsToBank(
  db: DbClient,
  params: {
    bankId: string;
    items: unknown[];
    skipInvalid?: boolean;
  }
): Promise<BatchImportResult> {
  const { bankId, items, skipInvalid = false } = params;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '导入题目列表为空' };
  }

  const normalizedWithMeta = items.map((raw, idx) => {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const draft = normalizeAndValidateDraft(obj, idx);
    return {
      draft,
      chapterId: obj.chapterId ? String(obj.chapterId) : null,
    };
  });

  const invalidItems: InvalidImportItem[] = normalizedWithMeta
    .map((entry, idx) => ({
      index: idx + 1,
      stem: entry.draft.stem.slice(0, 40) || '(空题干)',
      errors: entry.draft.errors,
    }))
    .filter((x) => x.errors.length > 0);

  if (invalidItems.length > 0 && !skipInvalid) {
    const first = invalidItems[0];
    return {
      ok: false,
      error: `共有 ${invalidItems.length} 道题目未通过格式校验（如第 ${first.index} 题：${first.errors.join('；')}），请先修正或勾选跳过异常题`,
      invalidItems,
    };
  }

  const validEntries = normalizedWithMeta.filter((entry) => entry.draft.errors.length === 0);
  if (validEntries.length === 0) {
    return { ok: false, error: '所有题目均存在格式错误，无可入库的合格试题' };
  }

  const insertedCount = await db.withTransaction(async (tx) => {
    const { rows: existingChapters } = await tx.query<{
      id: string;
      title: string;
      sort_order: number;
    }>('SELECT id, title, sort_order FROM chapters WHERE bank_id = $1', [bankId]);
    const chapterCache = new Map<string, string>();
    let maxChapterOrder = 0;
    for (const ch of existingChapters) {
      chapterCache.set(ch.title.trim(), ch.id);
      if (ch.sort_order > maxChapterOrder) maxChapterOrder = ch.sort_order;
    }

    const { rows: maxQRows } = await tx.query<{ max_order: number | null }>(
      'SELECT MAX(sort_order) AS max_order FROM questions WHERE bank_id = $1',
      [bankId]
    );
    let qOrder = Number(maxQRows[0]?.max_order ?? 0);
    let count = 0;

    for (const { draft, chapterId: explicitChapterId } of validEntries) {
      let chapterId: string | null = explicitChapterId;
      const chapterTitle = draft.chapterTitle;
      if (!chapterId && chapterTitle) {
        if (chapterCache.has(chapterTitle)) {
          chapterId = chapterCache.get(chapterTitle)!;
        } else {
          maxChapterOrder += 1;
          const { rows: newCh } = await tx.query<{ id: string }>(
            'INSERT INTO chapters (bank_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
            [bankId, chapterTitle, maxChapterOrder]
          );
          chapterId = newCh[0].id;
          chapterCache.set(chapterTitle, chapterId);
        }
      }

      qOrder += 1;
      await tx.query(
        `INSERT INTO questions (bank_id, chapter_id, type, stem, options, answer, explanation, difficulty, tags, sort_order)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)`,
        [
          bankId,
          chapterId,
          draft.type,
          draft.stem,
          JSON.stringify(draft.options),
          draft.answer,
          draft.explanation,
          draft.difficulty,
          JSON.stringify(draft.tags),
          qOrder,
        ]
      );
      count += 1;
    }

    await tx.query('UPDATE question_banks SET updated_at = NOW() WHERE id = $1', [bankId]);
    return count;
  });

  return {
    ok: true,
    insertedCount,
    skippedCount: invalidItems.length,
  };
}
