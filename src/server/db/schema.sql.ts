export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    settings JSONB NOT NULL DEFAULT '{"removeAfterCorrectCount":3,"autoNextOnCorrect":true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS total_active_seconds BIGINT NOT NULL DEFAULT 0;`,

  `CREATE TABLE IF NOT EXISTS user_usage_daily (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date TEXT NOT NULL,
    active_seconds INTEGER NOT NULL DEFAULT 0,
    practice_seconds INTEGER NOT NULL DEFAULT 0,
    exam_seconds INTEGER NOT NULL DEFAULT 0,
    heartbeat_count INTEGER NOT NULL DEFAULT 0,
    last_path TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, usage_date)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_user_usage_daily_date ON user_usage_daily(usage_date DESC);`,

  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '',
    target_label TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);`,

  `CREATE TABLE IF NOT EXISTS question_banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '默认分类',
    visibility TEXT NOT NULL DEFAULT 'private',
    clone_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_question_banks_owner ON question_banks(owner_id);`,
  `CREATE INDEX IF NOT EXISTS idx_question_banks_visibility ON question_banks(visibility);`,

  `ALTER TABLE question_banks ADD COLUMN IF NOT EXISTS share_code TEXT;`,
  `ALTER TABLE question_banks ADD COLUMN IF NOT EXISTS share_password TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE question_banks ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT FALSE;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_question_banks_share_code_unique ON question_banks(share_code) WHERE share_code IS NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS bank_shares (
    bank_id UUID NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    via TEXT NOT NULL DEFAULT 'direct',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bank_id, user_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_bank_shares_user ON bank_shares(user_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_bank_shares_bank ON bank_shares(bank_id);`,

  `CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_chapters_bank_id ON chapters(bank_id);`,

  `CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    stem TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    difficulty INTEGER NOT NULL DEFAULT 2,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_questions_bank_id ON questions(bank_id);`,
  `CREATE INDEX IF NOT EXISTS idx_questions_chapter_id ON questions(chapter_id);`,
  `CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS star_rating INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS rating_reason TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;`,
  `CREATE INDEX IF NOT EXISTS idx_questions_bank_type ON questions(bank_id, type);`,
  `CREATE INDEX IF NOT EXISTS idx_questions_bank_diff_star ON questions(bank_id, difficulty, star_rating);`,

  `CREATE TABLE IF NOT EXISTS user_question_records (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    bank_id UUID NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    answered_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    consecutive_correct INTEGER NOT NULL DEFAULT 0,
    in_mistake_book BOOLEAN NOT NULL DEFAULT FALSE,
    is_mastered BOOLEAN NOT NULL DEFAULT FALSE,
    is_favorited BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT NOT NULL DEFAULT '',
    last_answer TEXT,
    last_is_correct BOOLEAN,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, question_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_uqr_user_mistake ON user_question_records(user_id, in_mistake_book);`,
  `CREATE INDEX IF NOT EXISTS idx_uqr_user_fav ON user_question_records(user_id, is_favorited);`,
  `CREATE INDEX IF NOT EXISTS idx_uqr_user_bank ON user_question_records(user_id, bank_id);`,

  `CREATE TABLE IF NOT EXISTS user_bank_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_id UUID NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    last_question_index INTEGER NOT NULL DEFAULT 0,
    last_mode TEXT NOT NULL DEFAULT 'sequential',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, bank_id)
  );`,

  `CREATE TABLE IF NOT EXISTS exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_id UUID REFERENCES question_banks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    exam_type TEXT NOT NULL DEFAULT 'mock',
    share_code TEXT UNIQUE NOT NULL,
    access_password TEXT NOT NULL DEFAULT '',
    allow_guest BOOLEAN NOT NULL DEFAULT TRUE,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    total_score NUMERIC(6,1) NOT NULL DEFAULT 100,
    pass_score NUMERIC(6,1) NOT NULL DEFAULT 60,
    shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options BOOLEAN NOT NULL DEFAULT FALSE,
    max_tab_switches INTEGER NOT NULL DEFAULT 5,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'active',
    questions_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_exams_creator ON exams(creator_id);`,
  `CREATE INDEX IF NOT EXISTS idx_exams_share_code ON exams(share_code);`,
  `ALTER TABLE exams ADD COLUMN IF NOT EXISTS assembly_meta JSONB NOT NULL DEFAULT '{}'::jsonb;`,

  `CREATE TABLE IF NOT EXISTS exam_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    participant_name TEXT NOT NULL,
    participant_identifier TEXT NOT NULL DEFAULT '',
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    grading_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    score NUMERIC(6,1) NOT NULL DEFAULT 0,
    is_passed BOOLEAN NOT NULL DEFAULT FALSE,
    correct_count INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    tab_switch_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam ON exam_submissions(exam_id);`,
  `CREATE INDEX IF NOT EXISTS idx_exam_submissions_user ON exam_submissions(user_id);`,

  `CREATE TABLE IF NOT EXISTS ai_conversion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL DEFAULT 'extract',
    status TEXT NOT NULL DEFAULT 'queued',
    source_filename TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    source_char_count INTEGER NOT NULL DEFAULT 0,
    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    target_bank_id UUID REFERENCES question_banks(id) ON DELETE SET NULL,
    new_bank_title TEXT NOT NULL DEFAULT '',
    auto_import BOOLEAN NOT NULL DEFAULT FALSE,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    current_chunk INTEGER NOT NULL DEFAULT 0,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    progress_message TEXT NOT NULL DEFAULT '已加入后台队列，等待处理...',
    model_used TEXT NOT NULL DEFAULT '',
    detected_answer_key BOOLEAN NOT NULL DEFAULT FALSE,
    result_drafts JSONB NOT NULL DEFAULT '[]'::jsonb,
    result_summary JSONB NOT NULL DEFAULT '{"total":0,"validCount":0,"errorCount":0,"warningCount":0,"duplicateCount":0}'::jsonb,
    result_canonical_text TEXT NOT NULL DEFAULT '',
    imported_bank_id UUID REFERENCES question_banks(id) ON DELETE SET NULL,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`,

  `CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created ON ai_conversion_jobs(user_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_conversion_jobs(status);`,

  // 清理历史版本因部分更新 JSON 传入 null 而导致的 "null" 字符串昵称
  `UPDATE users SET nickname = username WHERE BTRIM(COALESCE(nickname, '')) = '' OR LOWER(BTRIM(nickname)) IN ('null', 'undefined');`,
];
