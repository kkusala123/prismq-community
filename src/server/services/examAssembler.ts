import {
  QUESTION_TYPE_LABELS,
  type DifficultyTier,
  type ExamAssemblyMeta,
  type ExamAssemblyStrategy,
  type QuestionType,
} from '../../shared/types.js';

export interface PoolQuestionLike {
  id: string;
  type: QuestionType;
  difficulty?: number;
  star_rating?: number;
  starRating?: number;
}

export interface AssembleExamOptions {
  strategy?: ExamAssemblyStrategy;
  difficultyRatio?: {
    easy?: number;
    medium?: number;
    hard?: number;
  };
  minStarRating?: number;
  counts?: Partial<Record<QuestionType, number>>;
  totalQuestions?: number;
}

export const STRATEGY_RATIOS: Record<'balanced' | 'easy_first' | 'hard_focus', { easy: number; medium: number; hard: number }> = {
  balanced: { easy: 30, medium: 50, hard: 20 },
  easy_first: { easy: 60, medium: 30, hard: 10 },
  hard_focus: { easy: 15, medium: 35, hard: 50 },
};

const NEIGHBOR_ORDER: Record<DifficultyTier, DifficultyTier[]> = {
  easy: ['medium', 'hard'],
  medium: ['easy', 'hard'],
  hard: ['medium', 'easy'],
};

export function getDifficultyTier(difficulty: number): DifficultyTier {
  const d = Number(difficulty || 2);
  if (d <= 2) return 'easy';
  if (d === 3) return 'medium';
  return 'hard';
}

function getEffectiveDifficulty(q: PoolQuestionLike): number {
  const val = Number(q.difficulty ?? 2);
  if (!Number.isFinite(val)) return 2;
  return Math.min(5, Math.max(1, Math.round(val)));
}

function getEffectiveStarRating(q: PoolQuestionLike): number {
  const val = Number(q.star_rating ?? q.starRating ?? 0);
  if (!Number.isFinite(val)) return 0;
  return Math.min(5, Math.max(0, Math.round(val)));
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function shuffleArray<T>(arr: readonly T[]): T[] {
  return shuffleInPlace([...arr]);
}

function sortHighStarDynamic<T extends PoolQuestionLike>(items: T[]): T[] {
  return [...items]
    .map((item) => ({
      item,
      rank: getEffectiveStarRating(item) + Math.random() * 0.85,
    }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.item);
}

function allocateByLargestRemainder(
  total: number,
  ratio: { easy: number; medium: number; hard: number }
): Record<DifficultyTier, number> {
  const sum = ratio.easy + ratio.medium + ratio.hard;
  const safeRatio = sum > 0 ? ratio : STRATEGY_RATIOS.balanced;
  const denom = safeRatio.easy + safeRatio.medium + safeRatio.hard;

  const tiers: DifficultyTier[] = ['easy', 'medium', 'hard'];
  const quotas: Record<DifficultyTier, number> = { easy: 0, medium: 0, hard: 0 };
  const remainders: Array<{ tier: DifficultyTier; rem: number; prio: number }> = [];

  for (const t of tiers) {
    const exact = (total * safeRatio[t]) / denom;
    quotas[t] = Math.floor(exact);
    remainders.push({
      tier: t,
      rem: exact - quotas[t],
      prio: t === 'medium' ? 2 : t === 'easy' ? 1 : 0,
    });
  }

  let left = total - (quotas.easy + quotas.medium + quotas.hard);
  remainders.sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : b.prio - a.prio));
  let idx = 0;
  while (left > 0) {
    quotas[remainders[idx % remainders.length].tier] += 1;
    left -= 1;
    idx += 1;
  }
  return quotas;
}

function pickFromSubset<T extends PoolQuestionLike>(
  candidates: T[],
  wanted: number,
  strategy: ExamAssemblyStrategy,
  ratio: { easy: number; medium: number; hard: number }
): { picked: T[]; fallbackUsed: boolean } {
  const cap = Math.min(wanted, candidates.length);
  if (cap <= 0) return { picked: [], fallbackUsed: false };

  if (strategy === 'random') {
    return { picked: shuffleInPlace([...candidates]).slice(0, cap), fallbackUsed: false };
  }

  if (strategy === 'high_star') {
    const starBuckets = new Map<number, T[]>();
    for (let s = 5; s >= 0; s -= 1) starBuckets.set(s, []);
    for (const q of candidates) {
      const s = getEffectiveStarRating(q);
      starBuckets.get(s)!.push(q);
    }
    const ordered: T[] = [];
    for (let s = 5; s >= 0; s -= 1) {
      ordered.push(...shuffleInPlace(starBuckets.get(s)!));
    }
    return { picked: ordered.slice(0, cap), fallbackUsed: false };
  }

  const quotas = allocateByLargestRemainder(cap, ratio);
  const buckets: Record<DifficultyTier, T[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  for (const q of candidates) {
    buckets[getDifficultyTier(getEffectiveDifficulty(q))].push(q);
  }
  buckets.easy = sortHighStarDynamic(buckets.easy);
  buckets.medium = sortHighStarDynamic(buckets.medium);
  buckets.hard = sortHighStarDynamic(buckets.hard);

  const pickedIds = new Set<string>();
  const picked: T[] = [];
  const shortfalls: Array<{ tier: DifficultyTier; count: number }> = [];
  let fallbackUsed = false;

  for (const tier of ['easy', 'medium', 'hard'] as const) {
    const need = quotas[tier];
    if (need <= 0) continue;
    const take = buckets[tier].slice(0, need);
    for (const q of take) {
      pickedIds.add(q.id);
      picked.push(q);
    }
    if (take.length < need) {
      shortfalls.push({ tier, count: need - take.length });
    }
  }

  // 若某一难度档题量不足，优先从最近邻难度顺位回补
  for (const { tier, count } of shortfalls) {
    let remaining = count;
    for (const neighbor of NEIGHBOR_ORDER[tier]) {
      if (remaining <= 0) break;
      for (const q of buckets[neighbor]) {
        if (pickedIds.has(q.id)) continue;
        pickedIds.add(q.id);
        picked.push(q);
        remaining -= 1;
        fallbackUsed = true;
        if (remaining <= 0) break;
      }
    }
  }

  if (picked.length < cap) {
    for (const q of sortHighStarDynamic(candidates)) {
      if (pickedIds.has(q.id)) continue;
      pickedIds.add(q.id);
      picked.push(q);
      if (picked.length >= cap) break;
    }
  }

  return { picked, fallbackUsed };
}

export function normalizeRatio(raw?: {
  easy?: number;
  medium?: number;
  hard?: number;
}): { easy: number; medium: number; hard: number } {
  const easy = Math.max(0, Number(raw?.easy ?? 0) || 0);
  const medium = Math.max(0, Number(raw?.medium ?? 0) || 0);
  const hard = Math.max(0, Number(raw?.hard ?? 0) || 0);
  if (easy + medium + hard <= 0) {
    return { ...STRATEGY_RATIOS.balanced };
  }
  return { easy, medium, hard };
}

export function assembleExamQuestions<T extends PoolQuestionLike>(
  pool: T[],
  options: AssembleExamOptions
): { picked: T[]; meta: ExamAssemblyMeta; warnings: string[] } {
  const strategy: ExamAssemblyStrategy = options.strategy || 'balanced';
  const minStarRating = Math.min(5, Math.max(0, Math.round(Number(options.minStarRating ?? 0) || 0)));
  const ratio =
    strategy === 'balanced' || strategy === 'easy_first' || strategy === 'hard_focus'
      ? { ...STRATEGY_RATIOS[strategy] }
      : strategy === 'custom_ratio'
        ? normalizeRatio(options.difficultyRatio)
        : undefined;

  const warnings: string[] = [];
  const eligiblePool =
    minStarRating > 0 ? pool.filter((q) => getEffectiveStarRating(q) >= minStarRating) : pool;

  if (minStarRating > 0 && eligiblePool.length === 0) {
    warnings.push(
      `当前范围内暂无达到 ${minStarRating} 星门槛的题目，建议先使用 DeepSeek AI 对题目进行星级评级或降低门槛`
    );
  }

  const picked: T[] = [];
  const hasCustomCounts = Boolean(
    options.counts && Object.values(options.counts).some((v) => Number(v) > 0)
  );
  const ratioToUse = ratio || STRATEGY_RATIOS.balanced;

  if (hasCustomCounts && options.counts) {
    const types: QuestionType[] = ['single', 'multiple', 'boolean', 'fill', 'short'];
    for (const t of types) {
      const wanted = Math.max(0, Math.round(Number(options.counts[t] ?? 0) || 0));
      if (wanted <= 0) continue;
      const subPool = eligiblePool.filter((q) => q.type === t);
      if (subPool.length < wanted) {
        warnings.push(
          `${QUESTION_TYPE_LABELS[t]}可用题量不足（需 ${wanted} 题，符合条件 ${subPool.length} 题）`
        );
      }
      const res = pickFromSubset(subPool, wanted, strategy, ratioToUse);
      if (res.fallbackUsed) {
        warnings.push(`${QUESTION_TYPE_LABELS[t]}部分难度档库存不足，已按邻近难度自动平衡补齐`);
      }
      picked.push(...res.picked);
    }
  } else {
    const totalWanted = Math.min(200, Math.max(1, Math.round(Number(options.totalQuestions ?? 20) || 20)));
    if (eligiblePool.length < totalWanted && eligiblePool.length > 0) {
      warnings.push(`题库符合条件的总题量不足（需 ${totalWanted} 题，可用 ${eligiblePool.length} 题）`);
    }
    const res = pickFromSubset(eligiblePool, totalWanted, strategy, ratioToUse);
    if (res.fallbackUsed) {
      warnings.push('部分难度档题量偏少，系统已通过邻近难度自动均衡补齐');
    }
    picked.push(...res.picked);
  }

  let easy = 0;
  let medium = 0;
  let hard = 0;
  let diffSum = 0;
  let starSum = 0;
  let ratedCount = 0;

  for (const q of picked) {
    const d = getEffectiveDifficulty(q);
    const s = getEffectiveStarRating(q);
    diffSum += d;
    if (s > 0) {
      ratedCount += 1;
      starSum += s;
    }
    const tier = getDifficultyTier(d);
    if (tier === 'easy') easy += 1;
    else if (tier === 'medium') medium += 1;
    else hard += 1;
  }

  const meta: ExamAssemblyMeta = {
    strategy,
    ...(ratio ? { difficultyRatio: ratio } : {}),
    ...(minStarRating > 0 ? { minStarRating } : {}),
    actualDistribution: {
      easy,
      medium,
      hard,
      avgDifficulty: picked.length > 0 ? Number((diffSum / picked.length).toFixed(2)) : 0,
      avgStarRating: ratedCount > 0 ? Number((starSum / ratedCount).toFixed(2)) : 0,
      ratedCount,
    },
  };

  return {
    picked,
    meta,
    warnings: Array.from(new Set(warnings)),
  };
}
