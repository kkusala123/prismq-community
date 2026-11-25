import type { QuestionType } from '../../shared/types.js';

export function normalizeBooleanToken(raw: string): 'A' | 'B' | '' {
  const cleaned = raw
    .trim()
    .replace(/^[（(\[【\s]+|[）)\]】\s.。、,，]+$/g, '')
    .trim()
    .toUpperCase();
  if (!cleaned) return '';
  if (['A', '对', '正确', '√', '✓', '✔', 'T', 'TRUE', 'YES', 'Y', '1', '是'].includes(cleaned)) {
    return 'A';
  }
  if (['B', '错', '错误', '×', '✗', 'X', '✘', '✕', '✖', 'F', 'FALSE', 'NO', 'N', '0', '否'].includes(cleaned)) {
    return 'B';
  }
  return '';
}

export function normalizeAnswer(type: QuestionType, raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  if (type === 'single') {
    const letters = trimmed.toUpperCase().match(/[A-H]/g);
    return letters && letters.length > 0 ? letters[0] : trimmed.toUpperCase();
  }

  if (type === 'multiple') {
    const letters = Array.from(new Set(trimmed.toUpperCase().match(/[A-H]/g) || [])).sort();
    return letters.join('');
  }

  if (type === 'boolean') {
    return normalizeBooleanToken(trimmed) || trimmed.toUpperCase();
  }

  if (type === 'fill') {
    return trimmed
      .split(/[|｜\n]+/)
      .map((part) => part.trim())
      .filter((part, idx, arr) => part.length > 0 || arr.length === 1)
      .join('|');
  }

  return trimmed;
}

function normalizeBlankText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，,。.;；:：!！?？“”"'‘’`~()（）\[\]【】]/g, '');
}

export function gradeQuestionAnswer(
  type: QuestionType,
  standardAnswer: string,
  userAnswer: string
): { isCorrect: boolean; normalizedUser: string; normalizedStandard: string } {
  const normalizedStandard = normalizeAnswer(type, standardAnswer);
  const normalizedUser = normalizeAnswer(type, userAnswer);

  if (!normalizedUser) {
    return { isCorrect: false, normalizedUser, normalizedStandard };
  }

  if (type === 'single' || type === 'multiple' || type === 'boolean') {
    return {
      isCorrect: normalizedUser === normalizedStandard && normalizedStandard.length > 0,
      normalizedUser,
      normalizedStandard,
    };
  }

  if (type === 'fill') {
    const stdBlanks = normalizedStandard.split('|').map((s) => s.trim());
    const usrBlanks = normalizedUser.split('|').map((s) => s.trim());
    if (stdBlanks.length === 0 || usrBlanks.length < stdBlanks.length) {
      return { isCorrect: false, normalizedUser, normalizedStandard };
    }
    const allMatch = stdBlanks.every((stdSlot, index) => {
      const candidates = stdSlot.split('//').map((c) => normalizeBlankText(c));
      const userSlot = normalizeBlankText(usrBlanks[index] ?? '');
      return userSlot.length > 0 && candidates.includes(userSlot);
    });
    return { isCorrect: allMatch, normalizedUser, normalizedStandard };
  }

  // short 简答题：精确或核心关键词覆盖度 >= 60%
  const cleanStd = normalizeBlankText(normalizedStandard);
  const cleanUser = normalizeBlankText(normalizedUser);
  if (!cleanStd) {
    return { isCorrect: cleanUser.length > 0, normalizedUser, normalizedStandard };
  }
  if (cleanUser === cleanStd) {
    return { isCorrect: true, normalizedUser, normalizedStandard };
  }
  const tokens = Array.from(
    new Set(
      normalizedStandard
        .split(/[\s，,。.;；:：、/()（）\[\]【】]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2)
    )
  );
  if (tokens.length === 0) {
    return { isCorrect: cleanUser.includes(cleanStd), normalizedUser, normalizedStandard };
  }
  const lowerUser = normalizedUser.toLowerCase();
  const hits = tokens.filter((t) => lowerUser.includes(t)).length;
  return {
    isCorrect: hits / tokens.length >= 0.6,
    normalizedUser,
    normalizedStandard,
  };
}
