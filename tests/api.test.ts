import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDbClient, type DbClient } from '../src/server/db/client.js';
import { createApp } from '../src/server/app.js';
import { createRateLimiter } from '../src/server/middleware/security.js';
import {
  buildDocxFromParagraphs,
  decodeBufferToText,
  extractAnswerKeySection,
  parseSpreadsheetBuffer,
  parseStructuredText,
  parseWordTablesFromHtml,
} from '../src/server/services/parser.js';
import {
  CANONICAL_FORMAT_SAMPLE,
  STANDARD_SCHEMA_VERSION,
  formatDraftsToCanonicalText,
  validateDraftBatch,
} from '../src/shared/questionSchema.js';
import {
  aiExtractQuestionsFromText,
  callDeepSeekChat,
  extractJsonObject,
  normalizeChatUrl,
  parseRatingItemsFromRawText,
  setAiRatingBatchRunnerForTesting,
} from '../src/server/services/deepseek.js';
import { getAiJobManager } from '../src/server/services/aiJobs.js';
import {
  compareSemver,
  isReleaseNewer,
  syncLatestApkFromGitHub,
} from '../src/server/services/appUpdate.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('棱题 · PrismQ 全链路后端与解析器集成测试', () => {
  let db: DbClient;
  let app: express.Express;

  let adminToken = '';
  let memberToken = '';
  let publicBankId = '';
  let questionIds: string[] = [];
  let examId = '';
  let shareCode = '';
  let guestSubmissionId = '';

  beforeAll(async () => {
    db = await createDbClient({ pgliteDataDir: ':memory:', runMigrations: true });
    app = createApp(db);
  });

  afterAll(async () => {
    const manager = getAiJobManager(db);
    manager.setExtractorForTesting(null);
    await manager.waitForIdle();
    await db.close();
  });

  it('健康检查应返回 ok 且引擎为 pglite', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dbEngine).toBe('pglite');
  });

  it('首个注册账号自动成为管理员 admin，第二个成为普通成员 member，且权限隔离生效', async () => {
    const beforeSetup = await request(app).get('/api/auth/bootstrap-status');
    expect(beforeSetup.status).toBe(200);
    expect(beforeSetup.body.needsSetup).toBe(true);

    const regAdmin = await request(app).post('/api/auth/register').send({
      username: 'boss',
      email: 'boss@example.com',
      password: 'Password123',
      nickname: '总管理员',
    });
    expect(regAdmin.status).toBe(201);
    expect(regAdmin.body.user.role).toBe('admin');
    adminToken = regAdmin.body.token;

    const afterSetup = await request(app).get('/api/auth/bootstrap-status');
    expect(afterSetup.status).toBe(200);
    expect(afterSetup.body.needsSetup).toBe(false);

    const regMember = await request(app).post('/api/auth/register').send({
      username: 'learner',
      email: 'learner@example.com',
      password: 'Password123',
      nickname: '备考同学',
    });
    expect(regMember.status).toBe(201);
    expect(regMember.body.user.role).toBe('member');
    memberToken = regMember.body.token;

    // 普通成员访问管理员接口被拒绝
    const forbidden = await request(app)
      .get('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(forbidden.status).toBe(403);

    // 管理员更新全局配置（脱敏返回）
    const putSys = await request(app)
      .put('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: '',
        allowMemberUseSystemKey: true,
      });
    expect(putSys.status).toBe(200);
    expect(putSys.body.aiConfig.model).toBe('deepseek-chat');
  });

  it('导题解析器应支持同行多选项、括号内嵌答案、判断题归一化及 GBK 中文解码', () => {
    const raw = `
一、单选题
1. 以下哪个命令可以查看 Docker 容器运行状态（ B ）。
A. docker build   B. docker ps   C. docker rmi   D. docker login
解析：docker ps 用于列出运行中的容器。

2. 【多选题】下列属于关系型数据库的是？
A. PostgreSQL
B. MySQL
C. Redis
答案：AB

3. 【判断题】HTTPS 默认端口是 443。
答案：正确
`;
    const drafts = parseStructuredText(raw, '默认章节');
    expect(drafts).toHaveLength(3);
    expect(drafts[0].type).toBe('single');
    expect(drafts[0].answer).toBe('B');
    expect(drafts[0].options).toHaveLength(4);
    expect(drafts[0].stem).not.toContain('( B )');

    expect(drafts[1].type).toBe('multiple');
    expect(drafts[1].answer).toBe('AB');

    expect(drafts[2].type).toBe('boolean');
    expect(drafts[2].answer).toBe('A');
    expect(drafts[2].options).toEqual([
      { key: 'A', content: '正确' },
      { key: 'B', content: '错误' },
    ]);

    // 测试 GB18030 中文字节流不乱码（“测试”在 GBK 中为 B2 E2 CA D4）
    const gbkBuf = Buffer.from([0xb2, 0xe2, 0xca, 0xd4]);
    expect(decodeBufferToText(gbkBuf)).toBe('测试');
  });

  it('下载标准 Excel 导题模板并上传解析应完整识别 5 种题型', async () => {
    const tplRes = await request(app)
      .get('/api/import/template')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(tplRes.status).toBe(200);
    const tplBuffer = tplRes.body as Buffer;
    expect(tplBuffer.length).toBeGreaterThan(1000);

    const parseRes = await request(app)
      .post('/api/import/parse-file')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', tplBuffer, 'template.xlsx');
    expect(parseRes.status).toBe(200);
    expect(parseRes.body.count).toBe(5);
    expect(parseRes.body.drafts.map((d: { type: string }) => d.type)).toEqual([
      'single',
      'multiple',
      'boolean',
      'fill',
      'short',
    ]);
  });

  it('创建公开题库、批量导入、Excel 导出往返、克隆题库全链路正常', async () => {
    const createBank = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Docker 与网络运维精选库',
        category: '运维测试',
        visibility: 'public',
      });
    expect(createBank.status).toBe(201);
    publicBankId = createBank.body.id;

    const parsed = parseStructuredText(`
1. Linux 查看当前工作路径的命令是？
A. pwd   B. cd   C. ls   D. rm
答案：A
章节：Linux 基础

2. 【多选】以下哪些属于 HTTP 成功或重定向状态码？
A. 200
B. 301
C. 404
答案：AB
章节：网络基础

3. 【填空】SSH 默认端口号为（   ）。
答案：22
章节：网络基础
`);

    const batchRes = await request(app)
      .post(`/api/banks/${publicBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: parsed });
    expect(batchRes.status).toBe(201);
    expect(batchRes.body.insertedCount).toBe(3);

    const detailRes = await request(app)
      .get(`/api/banks/${publicBankId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.chapters).toHaveLength(2);
    expect(detailRes.body.questions).toHaveLength(3);
    questionIds = detailRes.body.questions.map((q: { id: string }) => q.id);

    // 导出 Excel 并反向解析校验往返一致性
    const expRes = await request(app)
      .get(`/api/banks/${publicBankId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(expRes.status).toBe(200);
    const reParsed = parseSpreadsheetBuffer(expRes.body as Buffer, '.xlsx');
    expect(reParsed).toHaveLength(3);
    expect(reParsed[0].answer).toBe('A');

    // 成员从公共题库广场克隆题库
    const cloneRes = await request(app)
      .post(`/api/banks/${publicBankId}/clone`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({});
    expect(cloneRes.status).toBe(201);
    expect(cloneRes.body.id).not.toBe(publicBankId);
  });

  it('刷题判分、错题自动入库与连续答对自动移出、斩题收藏笔记、全局搜题正常', async () => {
    // 设置连对 2 次自动移出错题本，并测试切题动画速度与自动下一题延迟的保存与安全钳制
    const setRes = await request(app)
      .put('/api/auth/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        removeAfterCorrectCount: 2,
        autoNextDelayMs: 350,
        switchAnimationMs: 180,
      });
    expect(setRes.status).toBe(200);
    expect(setRes.body.user.settings.removeAfterCorrectCount).toBe(2);
    expect(setRes.body.user.settings.autoNextDelayMs).toBe(350);
    expect(setRes.body.user.settings.switchAnimationMs).toBe(180);

    // 越界值钳制在安全范围内（150~2500 / 0~600）
    const clampRes = await request(app)
      .put('/api/auth/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ autoNextDelayMs: 50, switchAnimationMs: 9999 });
    expect(clampRes.status).toBe(200);
    expect(clampRes.body.user.settings.autoNextDelayMs).toBe(150);
    expect(clampRes.body.user.settings.switchAnimationMs).toBe(600);

    await request(app)
      .put('/api/auth/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ autoNextDelayMs: 350, switchAnimationMs: 180 });

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.settings.autoNextDelayMs).toBe(350);
    expect(meRes.body.user.settings.switchAnimationMs).toBe(180);

    const q1 = questionIds[0]; // 答案 A

    // 1. 答错 -> 自动进入错题本
    const wrongRes = await request(app)
      .post('/api/practice/answer')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, answer: 'C', currentIndex: 0 });
    expect(wrongRes.status).toBe(200);
    expect(wrongRes.body.isCorrect).toBe(false);
    expect(wrongRes.body.record.inMistakeBook).toBe(true);

    // 2. 连续答对第 1 次 -> 仍在错题本
    const hit1 = await request(app)
      .post('/api/practice/answer')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, answer: 'A' });
    expect(hit1.body.isCorrect).toBe(true);
    expect(hit1.body.record.consecutiveCorrect).toBe(1);
    expect(hit1.body.record.inMistakeBook).toBe(true);
    expect(hit1.body.removedFromMistakeBook).toBe(false);

    // 3. 连续答对第 2 次 -> 达到阈值自动移出错题本
    const hit2 = await request(app)
      .post('/api/practice/answer')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, answer: 'A' });
    expect(hit2.body.isCorrect).toBe(true);
    expect(hit2.body.record.consecutiveCorrect).toBe(2);
    expect(hit2.body.record.inMistakeBook).toBe(false);
    expect(hit2.body.removedFromMistakeBook).toBe(true);

    // 斩题、收藏与笔记
    const masterRes = await request(app)
      .post('/api/practice/toggle')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, action: 'master' });
    expect(masterRes.body.isMastered).toBe(true);

    const favRes = await request(app)
      .post('/api/practice/toggle')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, action: 'favorite' });
    expect(favRes.body.isFavorited).toBe(true);

    const noteRes = await request(app)
      .put('/api/practice/note')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: q1, note: 'pwd = print working directory' });
    expect(noteRes.status).toBe(200);

    // 全局搜题（同时命中公共库原题与克隆副本）与按题库精确过滤
    const searchAllRes = await request(app)
      .get('/api/practice/search?q=工作路径')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(searchAllRes.status).toBe(200);
    expect(searchAllRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(searchAllRes.body.items.some((item: { id: string }) => item.id === q1)).toBe(true);

    const searchBankRes = await request(app)
      .get(`/api/practice/search?q=工作路径&bankId=${publicBankId}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(searchBankRes.status).toBe(200);
    expect(searchBankRes.body.items).toHaveLength(1);
    expect(searchBankRes.body.items[0].id).toBe(q1);
  });

  it('在线考试发布、口令校验、防漏题脱敏、访客交卷切屏计数、排行榜与调分正常', async () => {
    const createExam = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: publicBankId,
        title: '运维能力测试卷',
        examType: 'published',
        totalQuestions: 3,
        totalScore: 90,
        passScorePercent: 60,
        accessPassword: 'exam666',
        allowGuest: true,
        maxTabSwitches: 5,
      });
    expect(createExam.status).toBe(201);
    examId = createExam.body.id;
    shareCode = createExam.body.shareCode;
    expect(createExam.body.questionCount).toBe(3);

    // 无口令访问不返回题目
    const noPwdRes = await request(app).get(`/api/exams/join/${shareCode}`);
    expect(noPwdRes.status).toBe(200);
    expect(noPwdRes.body.requiresPassword).toBe(true);
    expect(noPwdRes.body.questions).toEqual([]);

    // 正确口令拉取题目，且严禁暴露 answer / explanation
    const joinRes = await request(app).get(`/api/exams/join/${shareCode}?password=exam666`);
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.requiresPassword).toBe(false);
    expect(joinRes.body.questions).toHaveLength(3);
    for (const q of joinRes.body.questions) {
      expect(q.answer).toBeUndefined();
      expect(q.explanation).toBeUndefined();
    }

    // 访客答对第 1 题与第 3 题，第 2 题答错
    const ansPayload: Record<string, string> = {};
    ansPayload[questionIds[0]] = 'A';
    ansPayload[questionIds[1]] = 'C'; // 错
    ansPayload[questionIds[2]] = '22';

    const submitGuest = await request(app)
      .post(`/api/exams/join/${shareCode}/submit`)
      .send({
        participantName: '王访客',
        participantIdentifier: 'EMP009',
        answers: ansPayload,
        durationSeconds: 120,
        tabSwitchCount: 2,
        accessPassword: 'exam666',
      });
    expect(submitGuest.status).toBe(201);
    expect(submitGuest.body.submission.score).toBe(60);
    expect(submitGuest.body.submission.isPassed).toBe(true);
    expect(submitGuest.body.submission.tabSwitchCount).toBe(2);
    guestSubmissionId = submitGuest.body.submission.id;

    // 组织者查看分析看板并人工调分
    const analyticsRes = await request(app)
      .get(`/api/exams/${examId}/analytics`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.summary.submissionCount).toBe(1);
    expect(analyticsRes.body.summary.avgScore).toBe(60);
    expect(analyticsRes.body.submissions[0].participantName).toBe('王访客');

    const gradeRes = await request(app)
      .put(`/api/exams/${examId}/submissions/${guestSubmissionId}/grade`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questionId: questionIds[1], earnedScore: 30 });
    expect(gradeRes.status).toBe(200);
    expect(gradeRes.body.score).toBe(90);
  });

  it('DeepSeek URL 归一化、JSON 提取与未配 Key 友好提示正常', async () => {
    expect(normalizeChatUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
    expect(normalizeChatUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
    expect(normalizeChatUrl('https://proxy.example.com/v1/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions'
    );

    const extracted = extractJsonObject<{ questions: Array<{ stem: string }> }>(`
      <think>让我先思考题目格式...</think>
      \`\`\`json
      {"questions":[{"stem":"测试AI解析"}]}
      \`\`\`
    `);
    expect(extracted.questions[0].stem).toBe('测试AI解析');

    const noKeyRes = await request(app)
      .post('/api/ai/explain')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: questionIds[0] });
    expect(noKeyRes.status).toBe(400);
    expect(noKeyRes.body.error).toContain('DeepSeek API Key');
  });

  it('标准 Schema 校验、双向格式化往返、Aiken/GIFT 解析、答案区识别与脏题拦截正常', async () => {
    // 1. 双向无损往返：标准示例 -> 解析 -> 再序列化 -> 再解析
    const firstPass = parseStructuredText(CANONICAL_FORMAT_SAMPLE);
    expect(firstPass).toHaveLength(5);
    expect(firstPass.every((d) => d.errors.length === 0)).toBe(true);
    expect(firstPass[0].sourceLine).toBeGreaterThan(1);

    const canonicalAgain = formatDraftsToCanonicalText(firstPass);
    const secondPass = parseStructuredText(canonicalAgain);
    expect(secondPass).toHaveLength(5);
    expect(secondPass.map((d) => [d.type, d.answer])).toEqual(
      firstPass.map((d) => [d.type, d.answer])
    );

    // 2. 阻塞性错误、警告与批内去重校验
    const badBatch = validateDraftBatch([
      {
        type: 'single',
        stem: '无效单选题示例',
        options: [
          { key: 'A', content: '甲' },
          { key: 'B', content: '乙' },
        ],
        answer: 'D', // 不在选项中 -> 阻塞错误
      },
      {
        type: 'fill',
        stem: '有两空的填空：（____）和（____）。',
        answer: '只有一空', // 空位与答案数不一致 + 缺解析 -> 警告
      },
      {
        type: 'boolean',
        stem: '有两空的填空：（____）和（____）。',
        answer: 'A', // 与上面同题干指纹 -> 重复警告
      },
    ]);
    expect(badBatch.summary.errorCount).toBe(1);
    expect(badBatch.summary.warningCount).toBe(3);
    expect(badBatch.summary.duplicateCount).toBe(1);
    expect(badBatch.drafts[0].errors[0]).toContain('不在选项范围内');
    expect(badBatch.drafts[2].isDuplicate).toBe(true);

    // 3. Aiken 与 Moodle GIFT 国际标准格式解析
    const aikenText = `What is the default HTTP port?
A. 21
B. 80
C. 443
ANSWER: B`;
    const aikenDrafts = parseStructuredText(aikenText);
    expect(aikenDrafts).toHaveLength(1);
    expect(aikenDrafts[0].type).toBe('single');
    expect(aikenDrafts[0].answer).toBe('B');

    const giftText = `地球是平的吗？ {F}

下列哪两个是关系型数据库？ {=PostgreSQL =MySQL ~Redis ~MongoDB}

HTTP 默认端口是{=80}。`;
    const giftDrafts = parseStructuredText(giftText);
    expect(giftDrafts).toHaveLength(3);
    expect(giftDrafts[0].type).toBe('boolean');
    expect(giftDrafts[0].answer).toBe('B');
    expect(giftDrafts[1].type).toBe('multiple');
    expect(giftDrafts[1].answer).toBe('AB');
    expect(giftDrafts[2].type).toBe('fill');
    expect(giftDrafts[2].answer).toBe('80');

    // 4. 文末集中参考答案区剥离检测
    const longPaper = `1. 题干一\nA. 1\nB. 2\n\n2. 题干二\nA. 1\nB. 2\n\n3. 题干三\nA. 1\nB. 2\n\n参考答案\n1. A 2. B 3. A`;
    const split = extractAnswerKeySection(longPaper);
    expect(split.bodyText).toContain('题干三');
    expect(split.bodyText).not.toContain('参考答案');
    expect(split.answerKeyText).toContain('1. A 2. B 3. A');

    // 5. GET /api/import/schema.json 与 POST /api/import/validate
    const schemaRes = await request(app).get('/api/import/schema.json');
    expect(schemaRes.status).toBe(200);
    expect(schemaRes.body.version).toBe(STANDARD_SCHEMA_VERSION);

    const valRes = await request(app)
      .post('/api/import/validate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: publicBankId,
        drafts: [
          {
            type: 'single',
            stem: 'Linux 查看当前工作路径的命令是？',
            options: [
              { key: 'A', content: 'pwd' },
              { key: 'B', content: 'cd' },
            ],
            answer: 'A',
          },
        ],
      });
    expect(valRes.status).toBe(200);
    expect(valRes.body.drafts[0].isDuplicate).toBe(true);

    // 6. 批量入库严格拦截含阻塞错误的题目，带 skipInvalid=true 时仅入库合格题
    const rejectBad = await request(app)
      .post(`/api/banks/${publicBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: badBatch.drafts });
    expect(rejectBad.status).toBe(400);
    expect(rejectBad.body.error).toContain('未通过格式校验');

    const skipBad = await request(app)
      .post(`/api/banks/${publicBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: badBatch.drafts, skipInvalid: true });
    expect(skipBad.status).toBe(201);
    expect(skipBad.body.insertedCount).toBe(2);
    expect(skipBad.body.skippedCount).toBe(1);
  });

  it('非管理员严格无法读取、探测或测试全局 AI API 配置', async () => {
    // 管理员设置带 Key 的全局 AI 服务（开启允许普通成员使用）
    const putGlobal = await request(app)
      .put('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseUrl: 'http://192.168.2.1:8788/v1',
        model: 'secret-global-model',
        apiKey: 'sk-secret-global-123456',
        allowMemberUseSystemKey: true,
      });
    expect(putGlobal.status).toBe(200);

    // 管理员查询自己全局配置可看到脱敏状态，但普通成员直接 403
    const adminRead = await request(app)
      .get('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.aiConfig.hasApiKey).toBe(true);

    const memberRead = await request(app)
      .get('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberRead.status).toBe(403);

    // 普通成员请求测试 scope=system 被 403 拒绝
    const memberTestSys = await request(app)
      .post('/api/ai/test')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ scope: 'system' });
    expect(memberTestSys.status).toBe(403);

    // 普通成员未传个人 Key 时，调用 /api/ai/test 或 /api/ai/models 禁止 fallback 到全局 Key
    const memberTestNoKey = await request(app)
      .post('/api/ai/test')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ baseUrl: 'http://192.168.2.1:8788/v1' });
    expect(memberTestNoKey.status).toBe(400);
    expect(memberTestNoKey.body.error).toContain('个人');

    const memberModelsNoKey = await request(app)
      .post('/api/ai/models')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ scope: 'personal' });
    expect(memberModelsNoKey.status).toBe(400);

    // /api/auth/me 不泄露全局 baseUrl / apiKey / model
    const meWhenAllowed = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(meWhenAllowed.status).toBe(200);
    expect(meWhenAllowed.body.user.systemAiAvailable).toBe(true);
    expect(JSON.stringify(meWhenAllowed.body.user)).not.toContain('192.168.2.1');
    expect(JSON.stringify(meWhenAllowed.body.user)).not.toContain('secret-global');

    // 管理员关闭 allowMemberUseSystemKey 后，member 的 systemAiAvailable 变为 false
    const disableMember = await request(app)
      .put('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseUrl: 'http://192.168.2.1:8788/v1',
        model: 'secret-global-model',
        allowMemberUseSystemKey: false,
      });
    expect(disableMember.status).toBe(200);

    const meWhenDisallowed = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(meWhenDisallowed.status).toBe(200);
    expect(meWhenDisallowed.body.user.systemAiAvailable).toBe(false);
  });

  it('标准 Word (.docx) 模板下载、段落/表格双模式直导、文末答案自动回填与题库 Word 导出往返正常', async () => {
    // 1. 下载标准 Word (.docx) 导题模板并直接上传至 /api/import/extract-raw
    const wordTplRes = await request(app)
      .get('/api/import/template-word')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(wordTplRes.status).toBe(200);
    const wordBuffer = wordTplRes.body as Buffer;
    expect(wordBuffer.length).toBeGreaterThan(500);

    const extractWordRes = await request(app)
      .post('/api/import/extract-raw')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', wordBuffer, '棱题PrismQ_标准导题模板.docx');
    expect(extractWordRes.status).toBe(200);
    expect(extractWordRes.body.mode).toBe('structured');
    expect(extractWordRes.body.sourceFormat).toBe('word-paragraph');
    expect(extractWordRes.body.count).toBe(5);
    expect(extractWordRes.body.summary.validCount).toBe(5);
    expect(extractWordRes.body.summary.errorCount).toBe(0);

    // 2. Word 表格模式 HTML 解析
    const tableHtml = `
      <table>
        <tr><th>章节</th><th>题型</th><th>题干</th><th>选项A</th><th>选项B</th><th>选项C</th><th>正确答案</th><th>解析</th></tr>
        <tr><td>第一章 网络</td><td>单选题</td><td>DNS 默认使用的端口是？</td><td>53</td><td>80</td><td>443</td><td>A</td><td>DNS 使用 53 端口</td></tr>
        <tr><td>第一章 网络</td><td>判断题</td><td>TCP 是面向无连接的传输层协议。</td><td>正确</td><td>错误</td><td></td><td>错误</td><td>UDP 才是无连接协议</td></tr>
      </table>
    `;
    const tableDrafts = parseWordTablesFromHtml(tableHtml);
    expect(tableDrafts).toHaveLength(2);
    expect(tableDrafts[0].type).toBe('single');
    expect(tableDrafts[0].answer).toBe('A');
    expect(tableDrafts[1].type).toBe('boolean');
    expect(tableDrafts[1].answer).toBe('B');

    // 3. 文末集中参考答案区免 AI 自动配对回填
    const paperWithEndKey = [
      '第一章 综合测试',
      '1. 题干一：HTTP 默认端口？',
      'A. 80',
      'B. 443',
      '',
      '2. 题干二：HTTPS 默认端口？',
      'A. 80',
      'B. 443',
      '',
      '3. 题干三：SSH 默认端口？',
      'A. 22',
      'B. 21',
      '',
      '参考答案',
      '1. A 2. B 3. A',
    ].join('\n');
    const backfilled = parseStructuredText(paperWithEndKey);
    expect(backfilled).toHaveLength(3);
    expect(backfilled.map((d) => d.answer)).toEqual(['A', 'B', 'A']);
    expect(backfilled.every((d) => d.errors.length === 0)).toBe(true);

    // 4. 题库导出为标准 Word (.docx) 并重新导入校验
    const exportWordRes = await request(app)
      .get(`/api/banks/${publicBankId}/export-word`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exportWordRes.status).toBe(200);
    const exportedDocx = exportWordRes.body as Buffer;

    const reimportWordRes = await request(app)
      .post('/api/import/parse-file')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', exportedDocx, 'exported.docx');
    expect(reimportWordRes.status).toBe(200);
    expect(reimportWordRes.body.count).toBeGreaterThanOrEqual(3);
    expect(reimportWordRes.body.summary.errorCount).toBe(0);
  });

  it('教材多章节 Word/文本混合题型、代码块在选项后、缺序号/缺前缀及文末分层参考答案回填正常', async () => {
    const textbookSample = [
      '教材习题及参考答案',
      '',
      '习题1',
      '1.判断题(叙述正确的，在括号内打√,否则打×)',
      '(1)Java语言的主要贡献者是James Gosling。',
      '(2)下列源文件可保存成dog.java。',
      'public class Dog {',
      'public void cry(){',
      'System.out.println("wangwang");',
      '}',
      '}',
      '2.单选题',
      '(1)对于下列源文件，(    )叙述是正确的。',
      'A.源文件名字必须是A.java',
      'B.源文件有错误',
      'C.源文件必须命名为E.java',
      'D.源文件中的E类不是主类',
      'public class E{',
      'public static void main(String []args){',
      'System.out.println("ok");',
      '}',
      '}',
      'class A{',
      'public static void main(String []args){}',
      '}',
      '',
      '习题5',
      '判断题(叙述正确的,在括号内打√,否则打 X)',
      '子类继承父类的构造方法。',
      '子类中想使用被子类隐藏的实例成员变量，就需要使用关键字super。',
      '(3)可以用final修饰构造方法。(    )',
      '2.单选题',
      '(1)为了给按钮注册事件，下列说法正确的是(    )。',
      'A.b.addActionListener(listen);',
      'B.b.addItemListener(listen);',
      'C.b.addKeyListener(listen);',
      'D.b.addWindowListener(listen);',
      '用下列代码替换【代码】会使程序输出hello的是(    )。',
      'public class Test{ int m = 0; }',
      'm---<=0      B.++m>0     C.m++>0    D.--m<0',
      '(3)下列叙述错误的是(    )。',
      '(3)下列叙述错误的是(    )。',
      'A.选项一',
      'B.选项二',
      'C.选项三',
      'D.选项四',
      '(4).下列叙述中，正确的是(    )。',
      'A.当无模式的对话框处于激活状态时，程序仍能激活其他窗口',
      'B.当有模式的对话框处于激活状态时，程序仍能激活其他窗口',
      'C.无模式的对话框中不可以添加按钮',
      'D.有模式的对话框中不可以添加按钮',
      '',
      '参考答案',
      '习题1',
      '1、判断题',
      '(1)（√）,(2)（×）',
      '2、单选题',
      '(1). C',
      '',
      '习题5',
      '1、判断题',
      '(1)（×）,(2)（√）,(3)（×）,(4)( √）',
      '2、单选题',
      '(1). A (2). C (3). D',
    ].join('\n');

    const sampleWithBool4 = textbookSample
      .replace(
        "(3)可以用final修饰构造方法。(    )",
        "(3)可以用final修饰构造方法。(    )\n(4)static内部类不能操作外嵌类中的实例成员变量。(     )"
      )
      .replace('(1)（×）,(2)（√）,(3)（×）,(4)( √）', '(1)（×）,(2)（√）,(3)( ×））,(4)( √）');

    const parsed = parseStructuredText(sampleWithBool4);
    expect(parsed).toHaveLength(11);

    // 确认无任何判断题被误判为 short 或 fill，也无标题行混入题目
    expect(parsed.filter((d) => d.type === 'short')).toHaveLength(0);
    expect(parsed.filter((d) => d.type === 'fill')).toHaveLength(0);
    expect(parsed.map((d) => [d.chapterTitle, d.type, d.answer])).toEqual([
      ['习题1', 'boolean', 'A'],
      ['习题1', 'boolean', 'B'],
      ['习题1', 'single', 'C'],
      ['习题5', 'boolean', 'B'],
      ['习题5', 'boolean', 'A'],
      ['习题5', 'boolean', 'B'],
      ['习题5', 'boolean', 'A'],
      ['习题5', 'single', 'A'],
      ['习题5', 'single', 'C'],
      ['习题5', 'single', 'D'],
      ['习题5', 'single', ''], // 原答案区仅列到 (3)，第 (4) 题不得跨章借用答案
    ]);

    // 验证 cry() 未被误替换为空白括号，且代码留在题干中
    expect(parsed[1].stem).toContain('public void cry()');
    expect(parsed[1].stem).not.toContain('（____）');

    // 验证选项后的独立类代码归入题干而非污染选项 D
    expect(parsed[2].stem).toContain('public class E{');
    expect(parsed[2].stem).toContain('class A{');
    expect(parsed[2].options[3].content).toBe('源文件中的E类不是主类');

    // 验证 lowercase b.addActionListener(...) 不会被误 strip 掉 "b."
    expect(parsed[7].options[0].content).toBe('b.addActionListener(listen);');

    // 验证缺 A. 前缀的同行选项自动恢复为 4 项
    expect(parsed[8].options).toEqual([
      { key: 'A', content: 'm---<=0' },
      { key: 'B', content: '++m>0' },
      { key: 'C', content: 'm++>0' },
      { key: 'D', content: '--m<0' },
    ]);

    // 验证连续重复粘贴题干去重与 "(4)." 括号后点号剥离
    expect(parsed[9].options).toHaveLength(4);
    expect(parsed[10].stem.startsWith('.')).toBe(false);
    expect(parsed[10].errors.length).toBeGreaterThan(0);

    // 验证打包为真实 .docx 后经 /api/import/extract-raw 接口端到端直导结果一致
    const docxBuffer = buildDocxFromParagraphs(
      sampleWithBool4.split('\n').map((text) => ({ text }))
    );
    const extractRes = await request(app)
      .post('/api/import/extract-raw')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', docxBuffer, 'java教材习题测试.docx');
    expect(extractRes.status).toBe(200);
    expect(extractRes.body.mode).toBe('structured');
    expect(extractRes.body.count).toBe(11);
    expect(extractRes.body.summary.validCount).toBe(10);
    expect(extractRes.body.summary.errorCount).toBe(1);
    expect(extractRes.body.drafts.every((d: { type: string }) => d.type !== 'short')).toBe(true);

    // 验证双向标准化往返一致性
    const roundTrip = parseStructuredText(extractRes.body.canonicalText);
    expect(roundTrip).toHaveLength(11);
    expect(roundTrip.map((d) => [d.type, d.answer])).toEqual(
      parsed.map((d) => [d.type, d.answer])
    );
  });

  it('后台异步 AI 转换任务：文件直传转换、自动建库入库、权限脱敏、取消重试、删除与重启恢复正常', async () => {
    const manager = getAiJobManager(db);

    try {
      // 1. 启用管理员全局 AI 服务并允许成员使用，以验证后台任务的权限脱敏与自动入库
      await request(app)
        .put('/api/auth/admin/ai-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          baseUrl: 'http://192.168.2.1:8788/v1',
          model: 'secret-bg-model',
          apiKey: 'sk-bg-secret-999',
          allowMemberUseSystemKey: true,
        });

      manager.setExtractorForTesting(async (_config, rawText, opts) => {
        await opts?.onProgress?.({ phase: 'starting', chunkIndex: 0, totalChunks: 2 });
        const validated = validateDraftBatch([
          {
            type: 'boolean',
            stem: `后台识别(${rawText.slice(0, 10)})：Java 接口可以多继承。`,
            options: [
              { key: 'A', content: '正确' },
              { key: 'B', content: '错误' },
            ],
            answer: 'A',
            explanation: 'Java 中接口支持 extends 多个父接口。',
            chapterTitle: '面向对象',
          },
          {
            type: 'single',
            stem: '后台异常示例题（缺少答案）',
            options: [
              { key: 'A', content: '甲' },
              { key: 'B', content: '乙' },
            ],
            answer: '', // 阻塞错误，启用 autoImport 时应被跳过
            chapterTitle: '面向对象',
          },
        ]);
        await opts?.onProgress?.({
          phase: 'extracting',
          chunkIndex: 2,
          totalChunks: 2,
          chunkDrafts: validated.drafts,
        });
        await opts?.onProgress?.({ phase: 'validating', chunkIndex: 2, totalChunks: 2 });
        return {
          drafts: validated.drafts,
          summary: validated.summary,
          canonicalText: formatDraftsToCanonicalText(validated.drafts),
          chunksProcessed: 2,
          detectedAnswerKey: true,
        };
      });

      // 2. 直接上传 Word (.docx) 至后台队列并开启转换完自动新建题库入库
      const docxBuf = buildDocxFromParagraphs([
        { text: 'Java 期末复习题库' },
        { text: '接口之间支持多继承特性。' },
      ]);

      const createRes = await request(app)
        .post('/api/ai/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('autoImport', 'true')
        .field('newBankTitle', '后台直转Java库')
        .field('defaultChapter', '默认章节')
        .attach('file', docxBuf, '中文试题直传文档.docx');

      expect(createRes.status).toBe(202);
      const jobId = createRes.body.job.id as string;
      expect(createRes.body.job.sourceFilename).toBe('中文试题直传文档.docx');
      expect(['queued', 'running', 'completed']).toContain(createRes.body.job.status);

      await manager.waitForIdle();

      // 列表接口应轻量且不返回大文本字段
      const listRes = await request(app)
        .get('/api/ai/jobs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.activeCount).toBe(0);
      const listedJob = listRes.body.jobs.find((j: { id: string }) => j.id === jobId);
      expect(listedJob).toBeTruthy();
      expect(listedJob.status).toBe('completed');
      expect(listedJob.progressPct).toBe(100);
      expect(listedJob.resultDrafts).toBeUndefined();
      expect(listedJob.importedCount).toBe(1);
      expect(listedJob.skippedCount).toBe(1);
      expect(listedJob.importedBankId).toBeTruthy();

      // 详情接口返回完整 drafts 与 canonicalText
      const detailRes = await request(app)
        .get(`/api/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.job.resultDrafts).toHaveLength(2);
      expect(detailRes.body.job.resultCanonicalText).toContain('Java 接口可以多继承');

      // 校验自动新建题库中已落库 1 道合格题
      const importedBankRes = await request(app)
        .get(`/api/banks/${listedJob.importedBankId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(importedBankRes.status).toBe(200);
      expect(importedBankRes.body.bank.title).toBe('后台直转Java库');
      expect(importedBankRes.body.questions).toHaveLength(1);

      // 3. 权限隔离：普通成员不能查看、取消或删除管理员的后台任务
      const forbiddenDetail = await request(app)
        .get(`/api/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(forbiddenDetail.status).toBe(404);

      const forbiddenDelete = await request(app)
        .delete(`/api/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(forbiddenDelete.status).toBe(404);

      // 4. 普通成员使用系统 AI 失败时，错误信息与模型名均需严格脱敏，且取消 -> 重试流程正常
      let failOnce = true;
      manager.setExtractorForTesting(async (_cfg, _txt, opts) => {
        if (failOnce) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(undefined), 1500);
            opts?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
              },
              { once: true }
            );
          });
          throw new Error('http://192.168.2.1:8788/v1 secret-bg-model connection error');
        }
        const okBatch = validateDraftBatch([
          {
            type: 'boolean',
            stem: '重试后成功提取的判断题。',
            answer: 'A',
          },
        ]);
        return {
          drafts: okBatch.drafts,
          summary: okBatch.summary,
          canonicalText: formatDraftsToCanonicalText(okBatch.drafts),
          chunksProcessed: 1,
          detectedAnswerKey: false,
        };
      });

      const memberCreateRes = await request(app)
        .post('/api/ai/jobs')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ rawText: '等待取消与重试的试题文本' });
      expect(memberCreateRes.status).toBe(202);
      const memberJobId = memberCreateRes.body.job.id as string;
      expect(memberCreateRes.body.job.modelUsed).toBe('系统内置 AI');
      expect(memberCreateRes.body.job.modelUsed).not.toContain('secret-bg-model');

      // 立即取消
      const cancelRes = await request(app)
        .post(`/api/ai/jobs/${memberJobId}/cancel`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.job.status).toBe('cancelled');
      await manager.waitForIdle();

      // 重试并完成
      failOnce = false;
      const retryRes = await request(app)
        .post(`/api/ai/jobs/${memberJobId}/retry`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(retryRes.status).toBe(202);
      expect(retryRes.body.job.status).toBe('queued');
      await manager.waitForIdle();

      const afterRetry = await request(app)
        .get(`/api/ai/jobs/${memberJobId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(afterRetry.status).toBe(200);
      expect(afterRetry.body.job.status).toBe('completed');
      expect(afterRetry.body.job.resultSummary.validCount).toBe(1);

      // 测试成员使用系统 AI 报错时的错误信息脱敏
      manager.setExtractorForTesting(async () => {
        throw new Error('upstream http://192.168.2.1:8788 failed with sk-bg-secret-999');
      });
      const failJobRes = await request(app)
        .post('/api/ai/jobs')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ rawText: '触发错误脱敏测试文本' });
      expect(failJobRes.status).toBe(202);
      const failJobId = failJobRes.body.job.id as string;
      await manager.waitForIdle();

      const failedDetail = await request(app)
        .get(`/api/ai/jobs/${failJobId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(failedDetail.status).toBe(200);
      expect(failedDetail.body.job.status).toBe('failed');
      expect(failedDetail.body.job.errorMessage).not.toContain('192.168.2.1');
      expect(failedDetail.body.job.errorMessage).not.toContain('sk-bg-secret-999');
      expect(failedDetail.body.job.errorMessage).toContain('系统 AI 服务暂时不可用');

      // 5. 测试重启恢复机制：模拟数据库中存在遗留 running 任务
      const fakeRunning = await db.query<{ id: string }>(
        `INSERT INTO ai_conversion_jobs (user_id, status, source_filename, source_text, source_char_count)
         SELECT id, 'running', 'crashed.docx', 'some text', 9 FROM users WHERE username = 'boss'
         RETURNING id`
      );
      const rec = await manager.recoverInterruptedJobs();
      expect(rec.recoveredFailed).toBeGreaterThanOrEqual(1);
      const crashedDetail = await request(app)
        .get(`/api/ai/jobs/${fakeRunning.rows[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(crashedDetail.status).toBe(200);
      expect(crashedDetail.body.job.status).toBe('failed');
      expect(crashedDetail.body.job.errorMessage).toContain('中断');

      // 6. 删除任务
      const delRes = await request(app)
        .delete(`/api/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.ok).toBe(true);

      const deletedCheck = await request(app)
        .get(`/api/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deletedCheck.status).toBe(404);
    } finally {
      manager.setExtractorForTesting(null);
      await manager.waitForIdle();
    }
  });

  it('AI 网关空正文思考截断自动扩容、400 上限降级、数组内容解析与分块自动二分容错正常', async () => {
    const originalFetch = globalThis.fetch;
    const dummyCfg = {
      baseUrl: 'http://mock-ai.local/v1',
      apiKey: 'sk-test-123456',
      model: 'deepseek-v4.1-flash',
      source: 'personal' as const,
    };

    try {
      // 场景 A：思考模型首包返回 HTTP 200 + finish_reason=length + content="" -> 自动扩容 max_tokens 并去掉 response_format 重试成功
      const callsA: Array<Record<string, unknown>> = [];
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const parsedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        callsA.push(parsedBody);
        if (callsA.length === 1) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'length',
                  message: { role: 'assistant', content: '', reasoning_content: '思考过程耗尽...' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { role: 'assistant', content: '{"ok":true}' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const resA = await callDeepSeekChat(
        dummyCfg,
        [{ role: 'user', content: 'test' }],
        { maxTokens: 4096, jsonMode: true }
      );
      expect(resA.content).toBe('{"ok":true}');
      expect(callsA).toHaveLength(2);
      expect(callsA[0].max_tokens).toBe(4096);
      expect(callsA[0].response_format).toEqual({ type: 'json_object' });
      expect(Number(callsA[1].max_tokens)).toBeGreaterThanOrEqual(16384);
      expect(callsA[1].response_format).toBeUndefined();

      // 场景 B：传 16384 上游返回 400 提示 max_tokens <= 8192 -> 自动降级到 8192 重试成功
      const callsB: Array<Record<string, unknown>> = [];
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        const parsedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        callsB.push(parsedBody);
        if (callsB.length === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Invalid max_tokens: must be <= 8192' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const resB = await callDeepSeekChat(
        dummyCfg,
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 16384 }
      );
      expect(resB.content).toBe('OK');
      expect(callsB.map((c) => c.max_tokens)).toEqual([16384, 8192]);

      // 场景 C：上游返回多段 content 数组 -> 自动拼接提取
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: [
                    { type: 'text', text: '{"questions":' },
                    { type: 'text', text: '[]}' },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch;

      const resC = await callDeepSeekChat(dummyCfg, [{ role: 'user', content: 'arr' }]);
      expect(resC.content).toBe('{"questions":[]}');

      // 场景 D：单个分块触发空正文 length 错误 -> aiExtractQuestionsFromText 自动二分拆解后提取成功
      const longChunkBody = [
        '1. 判断题\n',
        Array.from({ length: 18 }, (_, i) => `(${i + 1}) Java 第 ${i + 1} 题陈述正确与否。`).join(
          '\n'
        ),
        '\n',
        Array.from({ length: 18 }, (_, i) => `(${i + 19}) Java 第 ${i + 19} 题陈述正确与否。`).join(
          '\n'
        ),
      ].join('\n');

      let reqCounter = 0;
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        reqCounter += 1;
        const parsedBody = JSON.parse(String(init?.body || '{}')) as {
          messages?: Array<{ content?: string }>;
        };
        const promptText = parsedBody.messages?.[1]?.content || '';
        // 含全部 36 题（即第 1 题和第 36 题同时出现）时模拟思考截断，拆半后分别成功返回
        if (promptText.includes('(1) Java') && promptText.includes('(36) Java')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'length',
                  message: { role: 'assistant', content: '', reasoning_content: '太长了' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const tag = promptText.includes('(1) Java') ? '上半部分题目' : '下半部分题目';
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    questions: [
                      {
                        type: 'boolean',
                        stem: `${tag}示例`,
                        options: [
                          { key: 'A', content: '正确' },
                          { key: 'B', content: '错误' },
                        ],
                        answer: 'A',
                        explanation: '解析',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const resD = await aiExtractQuestionsFromText(dummyCfg, longChunkBody);
      expect(reqCounter).toBeGreaterThanOrEqual(3);
      expect(resD.drafts.map((d) => d.stem)).toEqual(['上半部分题目示例', '下半部分题目示例']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('私有题库支持定向授权与分享码私密分享，且分享后严格保持私有性质', async () => {
    // 注册第 3 位普通用户 stranger，用于验证未获授权成员对私密分享题库完全不可见
    const regStranger = await request(app).post('/api/auth/register').send({
      username: 'stranger',
      email: 'stranger@example.com',
      password: 'Password123',
      nickname: '旁观同学',
    });
    expect(regStranger.status).toBe(201);
    const strangerToken = regStranger.body.token as string;
    const strangerUserId = regStranger.body.user.id as string;

    const learnerMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    const learnerUserId = learnerMe.body.user.id as string;

    // 1. 管理员创建一个个人私有题库并导入一道专有题目
    const createPriv = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: '高密私有内部冲刺题库',
        category: '内部资料',
        visibility: 'private',
      });
    expect(createPriv.status).toBe(201);
    const privBankId = createPriv.body.id as string;

    const insertPrivQ = await request(app)
      .post(`/api/banks/${privBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        questions: [
          {
            type: 'single',
            stem: '私密题库唯一特征关键词：PRIV_SHARE_SECRET_Q1',
            options: [
              { key: 'A', content: '选项甲' },
              { key: 'B', content: '选项乙' },
            ],
            answer: 'A',
          },
        ],
      });
    expect(insertPrivQ.status).toBe(201);

    // 未分享前，普通成员完全不可访问也搜不到
    const beforeLearner = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(beforeLearner.status).toBe(404);

    const searchBefore = await request(app)
      .get('/api/practice/search?q=PRIV_SHARE_SECRET_Q1')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(searchBefore.body.items).toHaveLength(0);

    // 2. 定向授权给 learner
    const grantRes = await request(app)
      .post(`/api/banks/${privBankId}/shares`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ account: 'learner' });
    expect(grantRes.status).toBe(201);
    expect(grantRes.body.members).toHaveLength(1);
    expect(grantRes.body.members[0].username).toBe('learner');

    // 验证原题库仍然保持私有，不会出现在公共题库广场或工作台推荐广场
    const pubList = await request(app)
      .get('/api/banks?scope=public')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(pubList.body.banks.some((b: { id: string }) => b.id === privBankId)).toBe(false);

    const dashStranger = await request(app)
      .get('/api/practice/dashboard')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(
      dashStranger.body.publicBanks.some((b: { id: string }) => b.id === privBankId)
    ).toBe(false);

    // 未获授权的 stranger 仍然 404 且搜不到
    const strangerGet = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(strangerGet.status).toBe(404);

    // learner 在「好友分享给我 (scope=shared)」可见，详情中仍为 private 且不可编辑
    const sharedList = await request(app)
      .get('/api/banks?scope=shared')
      .set('Authorization', `Bearer ${memberToken}`);
    const sharedEntry = sharedList.body.banks.find((b: { id: string }) => b.id === privBankId);
    expect(sharedEntry).toBeTruthy();
    expect(sharedEntry.visibility).toBe('private');
    expect(sharedEntry.sharedWithMe).toBe(true);

    const learnerDetail = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(learnerDetail.status).toBe(200);
    expect(learnerDetail.body.bank.visibility).toBe('private');
    expect(learnerDetail.body.bank.canEdit).toBe(false);
    expect(learnerDetail.body.bank.isSharedWithMe).toBe(true);
    expect(learnerDetail.body.bank.shareCode).toBeUndefined(); // 不向被分享者暴露分享码

    // learner 可刷题、可搜题、可用作克隆私人副本，但不可修改/删除/管理分享
    const learnerSearch = await request(app)
      .get('/api/practice/search?q=PRIV_SHARE_SECRET_Q1')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(learnerSearch.body.items).toHaveLength(1);

    const learnerEditFail = await request(app)
      .put(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ visibility: 'public' });
    expect(learnerEditFail.status).toBe(403);

    const learnerShareFail = await request(app)
      .put(`/api/banks/${privBankId}/share-settings`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ shareEnabled: true });
    expect(learnerShareFail.status).toBe(403);

    const cloneShared = await request(app)
      .post(`/api/banks/${privBankId}/clone`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({});
    expect(cloneShared.status).toBe(201);
    const clonedDetail = await request(app)
      .get(`/api/banks/${cloneShared.body.id}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(clonedDetail.body.bank.visibility).toBe('private');
    expect(clonedDetail.body.bank.shareEnabled).toBe(false);

    // 作者撤销 learner 授权后立即失去访问权
    const revokeRes = await request(app)
      .delete(`/api/banks/${privBankId}/shares/${learnerUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(afterRevoke.status).toBe(404);

    // 3. 开启私密分享码 + 口令
    const enableRes = await request(app)
      .put(`/api/banks/${privBankId}/share-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shareEnabled: true, sharePassword: 'vip888' });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.shareEnabled).toBe(true);
    expect(enableRes.body.hasSharePassword).toBe(true);
    const shareCode = enableRes.body.shareCode as string;
    expect(shareCode).toHaveLength(8);

    // 预览安全元数据：不暴露题干，仅告知需口令及保持 private
    const previewRes = await request(app)
      .get(`/api/banks/share/${shareCode}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.bank.visibility).toBe('private');
    expect(previewRes.body.bank.requiresPassword).toBe(true);
    expect(previewRes.body.bank.questions).toBeUndefined();

    // 口令错误被拒绝
    const wrongPwdJoin = await request(app)
      .post('/api/banks/share/join')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ shareCode, password: 'wrong' });
    expect(wrongPwdJoin.status).toBe(403);

    // 正确口令成功加入，且原题库依然不在公共广场
    const okJoin = await request(app)
      .post('/api/banks/share/join')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ shareCode, password: 'vip888' });
    expect(okJoin.status).toBe(200);
    expect(okJoin.body.bankId).toBe(privBankId);
    expect(okJoin.body.visibility).toBe('private');

    const strangerCanRead = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(strangerCanRead.status).toBe(200);

    // 被分享者可主动退出分享
    const selfExit = await request(app)
      .delete(`/api/banks/${privBankId}/shares/${strangerUserId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(selfExit.status).toBe(200);

    const afterExit = await request(app)
      .get(`/api/banks/${privBankId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(afterExit.status).toBe(404);

    // 作者关闭分享链接后，分享码立即失效 (404)
    const disableRes = await request(app)
      .put(`/api/banks/${privBankId}/share-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shareEnabled: false });
    expect(disableRes.status).toBe(200);

    const closedPreview = await request(app)
      .get(`/api/banks/share/${shareCode}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(closedPreview.status).toBe(404);
  });

  it('公网部署安全响应头、生产 CORS 白名单、SSRF 防护、异常 JSON 处理与限流策略正常', async () => {
    // 1. 安全响应头 & 反代 HTTPS HSTS & robots.txt
    const healthRes = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers['x-powered-by']).toBeUndefined();
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['x-frame-options']).toBe('DENY');
    expect(healthRes.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(healthRes.headers['strict-transport-security']).toContain('max-age=31536000');

    const robotsRes = await request(app).get('/robots.txt');
    expect(robotsRes.status).toBe(200);
    expect(robotsRes.headers['content-type']).toContain('text/plain');
    expect(robotsRes.text).toContain('Disallow: /api/');
    expect(robotsRes.text).toContain('Disallow: /banks/share/');

    // 2. 非法 JSON 请求体返回结构化 400 JSON 而非堆栈 HTML
    const badJsonRes = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"account": "broken-json"');
    expect(badJsonRes.status).toBe(400);
    expect(badJsonRes.body.error).toContain('JSON');

    // 3. SSRF 防护：普通成员配置内网/本机/元数据/Docker 单标签地址均被拒绝，管理员配置内网中转不受阻
    const blockedUrls = [
      'http://127.0.0.1:3000/v1',
      'http://192.168.1.1/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://postgres:5432/v1',
    ];
    for (const ssrfUrl of blockedUrls) {
      const saveBadRes = await request(app)
        .put('/api/auth/settings')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          aiConfig: {
            baseUrl: ssrfUrl,
            model: 'deepseek-chat',
            apiKey: 'sk-member-ssrf-check',
          },
        });
      expect(saveBadRes.status).toBe(400);
      expect(saveBadRes.body.error).toContain('内网地址');

      const testBadRes = await request(app)
        .post('/api/ai/test')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          scope: 'personal',
          baseUrl: ssrfUrl,
          model: 'deepseek-chat',
          apiKey: 'sk-member-ssrf-check',
        });
      expect(testBadRes.status).toBe(400);
      expect(testBadRes.body.error).toContain('内网地址');
    }

    const adminRelaySave = await request(app)
      .put('/api/auth/admin/ai-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseUrl: 'http://192.168.2.1:8788/v1',
        model: 'secret-global-model',
      });
    expect(adminRelaySave.status).toBe(200);

    // 4. 生产模式 CORS 白名单校验（放行白名单、放行无 Origin 客户端、拒绝未授权跨域）
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCors = process.env.CORS_ORIGINS;
    const prevPublicUrl = process.env.PUBLIC_URL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_URL = 'https://prismq.example.com';
      process.env.CORS_ORIGINS = 'https://prismq.example.com';
      const prodApp = createApp(db);

      const allowedCors = await request(prodApp)
        .get('/api/health')
        .set('Host', 'prismq.example.com')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://prismq.example.com');
      expect(allowedCors.status).toBe(200);
      expect(allowedCors.headers['access-control-allow-origin']).toBe('https://prismq.example.com');

      const evilCors = await request(prodApp)
        .get('/api/health')
        .set('Host', 'prismq.example.com')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://evil.example.com');
      expect(evilCors.status).toBe(200);
      expect(evilCors.headers['access-control-allow-origin']).toBeUndefined();

      const nativeNoOrigin = await request(prodApp)
        .get('/api/health')
        .set('Host', 'prismq.example.com')
        .set('X-Forwarded-Proto', 'https');
      expect(nativeNoOrigin.status).toBe(200);
      expect(nativeNoOrigin.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prevCors;
      if (prevPublicUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = prevPublicUrl;
    }

    // 5. 限流中间件超限触发 429 与 Retry-After
    const miniApp = express();
    miniApp.get(
      '/limited',
      createRateLimiter({
        windowMs: 60000,
        max: 2,
        keyPrefix: 'test:limit',
        message: '触发测试限流',
      }),
      (_req, res) => {
        res.json({ ok: true });
      }
    );
    expect((await request(miniApp).get('/limited')).status).toBe(200);
    expect((await request(miniApp).get('/limited')).status).toBe(200);
    const blockedRes = await request(miniApp).get('/limited');
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.body.error).toBe('触发测试限流');
  });

  it('题型分类统计、DeepSeek 星级与难度评级及动态均衡组卷全链路', async () => {
    const createBankRes = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'DS 智能评级与均衡组卷测试库',
        description: '涵盖多种题型、难度与星级分布',
        category: '计算机',
        visibility: 'public',
      });
    expect(createBankRes.status).toBe(201);
    const smartBankId = createBankRes.body.id as string;

    const drafts = [
      { type: 'single', stem: '基础单选1：HTTP 默认端口是？', options: [{ key: 'A', content: '80' }, { key: 'B', content: '443' }], answer: 'A', difficulty: 2 },
      { type: 'single', stem: '基础单选2：TCP 属于哪一层？', options: [{ key: 'A', content: '传输层' }, { key: 'B', content: '网络层' }], answer: 'A', difficulty: 2 },
      { type: 'single', stem: '中等单选3：TLS 握手核心目的是？', options: [{ key: 'A', content: '协商会话密钥' }, { key: 'B', content: '分配MAC' }], answer: 'A', difficulty: 3 },
      { type: 'single', stem: '中等单选4：B+树索引的优势是？', options: [{ key: 'A', content: '适合范围查询' }, { key: 'B', content: '仅支持Hash' }], answer: 'A', difficulty: 3 },
      { type: 'multiple', stem: '偏难多选5：属于 MVCC 机制要素的有哪些？', options: [{ key: 'A', content: '版本链' }, { key: 'B', content: 'ReadView' }, { key: 'C', content: 'ARP表' }], answer: 'AB', difficulty: 4 },
      { type: 'multiple', stem: '偏难多选6：Raft 共识协议包含哪些角色？', options: [{ key: 'A', content: 'Leader' }, { key: 'B', content: 'Follower' }, { key: 'C', content: 'Candidate' }], answer: 'ABC', difficulty: 5 },
      { type: 'boolean', stem: '简单判断7：HTTPS 默认端口为 443', options: [{ key: 'A', content: '正确' }, { key: 'B', content: '错误' }], answer: 'A', difficulty: 1 },
      { type: 'boolean', stem: '中等判断8：UDP 提供可靠有序传输', options: [{ key: 'A', content: '正确' }, { key: 'B', content: '错误' }], answer: 'B', difficulty: 3 },
      { type: 'fill', stem: '填空9：PostgreSQL 使用 ____ 存储结构化JSON', options: [], answer: 'JSONB', difficulty: 3 },
      { type: 'short', stem: '困难简答10：简述分布式事务两阶段提交的缺点', options: [], answer: '同步阻塞与单点协调者故障风险', difficulty: 5 },
    ];

    const bulkRes = await request(app)
      .post(`/api/banks/${smartBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ questions: drafts });
    expect(bulkRes.status).toBe(201);
    expect(bulkRes.body.insertedCount).toBe(10);

    // 1. 非题主成员发起 AI 评级应返回 403
    const forbiddenRate = await request(app)
      .post('/api/ai/rate-bank')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ bankId: smartBankId, onlyUnrated: true });
    expect(forbiddenRate.status).toBe(403);

    // 2. 使用测试桩注入 DeepSeek 批量打分，完成星级/难度/理由持久化
    setAiRatingBatchRunnerForTesting(async (_config, batch) =>
      batch.map((item) => {
        if (item.stem.includes('单选1')) return { id: item.id, difficulty: 1, starRating: 5, reason: '基础高频必考端口题' };
        if (item.stem.includes('单选2')) return { id: item.id, difficulty: 2, starRating: 3, reason: 'OSI模型基础概念' };
        if (item.stem.includes('单选3')) return { id: item.id, difficulty: 3, starRating: 4, reason: 'TLS安全高频考点' };
        if (item.stem.includes('单选4')) return { id: item.id, difficulty: 3, starRating: 5, reason: '数据库索引核心机制' };
        if (item.stem.includes('多选5')) return { id: item.id, difficulty: 4, starRating: 5, reason: '事务隔离与MVCC压轴' };
        if (item.stem.includes('多选6')) return { id: item.id, difficulty: 5, starRating: 5, reason: '分布式共识高频难点' };
        if (item.stem.includes('判断7')) return { id: item.id, difficulty: 1, starRating: 2, reason: '常识送分题' };
        if (item.stem.includes('判断8')) return { id: item.id, difficulty: 3, starRating: 4, reason: '易混淆协议对比' };
        if (item.stem.includes('填空9')) return { id: item.id, difficulty: 3, starRating: 4, reason: 'PostgreSQL高频特性' };
        return { id: item.id, difficulty: 5, starRating: 5, reason: '2PC经典架构简答压轴' };
      })
    );

    try {
      const rateRes = await request(app)
        .post('/api/ai/rate-bank')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId: smartBankId, onlyUnrated: true });
      expect(rateRes.status).toBe(200);
      expect(rateRes.body.ratedCount).toBe(10);
      expect(rateRes.body.remainingUnrated).toBe(0);
    } finally {
      setAiRatingBatchRunnerForTesting(null);
    }

    // 3. 题库详情应返回完整 stats（题型计数、难易计数、均星级）及筛选结果
    const detailAll = await request(app)
      .get(`/api/banks/${smartBankId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailAll.status).toBe(200);
    expect(detailAll.body.stats).toBeDefined();
    expect(detailAll.body.stats.totalCount).toBe(10);
    expect(detailAll.body.stats.ratedCount).toBe(10);
    expect(detailAll.body.stats.typeCounts).toEqual({
      single: 4,
      multiple: 2,
      boolean: 2,
      fill: 1,
      short: 1,
    });
    expect(detailAll.body.stats.difficultyCounts).toEqual({
      easy: 3,
      medium: 4,
      hard: 3,
    });
    expect(detailAll.body.stats.avgStarRating).toBeGreaterThan(3.5);

    const filteredEasyHighStar = await request(app)
      .get(`/api/banks/${smartBankId}?type=single&difficultyTier=easy&minStar=4`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filteredEasyHighStar.status).toBe(200);
    expect(filteredEasyHighStar.body.questions).toHaveLength(1);
    expect(filteredEasyHighStar.body.questions[0].starRating).toBe(5);

    // 4. 按题型 + 难度分档刷题队列
    const practiceFiltered = await request(app)
      .get(`/api/practice/session?bankId=${smartBankId}&mode=type&type=single&difficultyTier=medium`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(practiceFiltered.status).toBe(200);
    expect(practiceFiltered.body.questions).toHaveLength(2);
    expect(practiceFiltered.body.questions.every((q: { difficulty: number }) => q.difficulty === 3)).toBe(true);

    // 5. 动态与难度均衡组卷预演（30:50:20 抽 10 题应严格命中 3 / 5 / 2 或受限于库存 3 / 4 / 3 合理回补）
    const previewRes = await request(app)
      .post('/api/exams/preview-assembly')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: smartBankId,
        totalQuestions: 7,
        strategy: 'balanced',
        minStarRating: 3,
      });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.projected.totalPicked).toBe(7);
    expect(previewRes.body.projected.meta.strategy).toBe('balanced');
    const dist = previewRes.body.projected.meta.actualDistribution;
    expect(dist.easy + dist.medium + dist.hard).toBe(7);

    // 6. 正式创建难度均衡试卷并校验 assemblyMeta 持久化与高难度聚焦对比
    const balancedExamRes = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: smartBankId,
        title: '均衡动态组卷测试',
        examType: 'published',
        totalQuestions: 7,
        strategy: 'balanced',
        minStarRating: 3,
      });
    expect(balancedExamRes.status).toBe(201);
    expect(balancedExamRes.body.questionCount).toBe(7);
    expect(balancedExamRes.body.assemblyMeta.strategy).toBe('balanced');
    expect(balancedExamRes.body.assemblyMeta.minStarRating).toBe(3);

    const hardExamRes = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: smartBankId,
        title: '高难攻坚冲刺测试',
        examType: 'published',
        totalQuestions: 5,
        strategy: 'hard_focus',
        minStarRating: 4,
      });
    expect(hardExamRes.status).toBe(201);
    expect(hardExamRes.body.assemblyMeta.strategy).toBe('hard_focus');
    expect(hardExamRes.body.assemblyMeta.actualDistribution.easy).toBe(1);
    expect(hardExamRes.body.assemblyMeta.actualDistribution.medium).toBe(2);
    expect(hardExamRes.body.assemblyMeta.actualDistribution.hard).toBe(2);
    expect(hardExamRes.body.assemblyMeta.actualDistribution.avgDifficulty).toBeGreaterThanOrEqual(3.2);

    const easyExamRes = await request(app)
      .post('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: smartBankId,
        title: '基础巩固递进测试',
        examType: 'published',
        totalQuestions: 5,
        strategy: 'easy_first',
      });
    expect(easyExamRes.status).toBe(201);
    expect(easyExamRes.body.assemblyMeta.strategy).toBe('easy_first');
    expect(easyExamRes.body.assemblyMeta.actualDistribution.easy).toBe(3);
    expect(easyExamRes.body.assemblyMeta.actualDistribution.medium).toBe(2);
    expect(easyExamRes.body.assemblyMeta.actualDistribution.hard).toBe(0);
    expect(hardExamRes.body.assemblyMeta.actualDistribution.avgDifficulty).toBeGreaterThan(
      easyExamRes.body.assemblyMeta.actualDistribution.avgDifficulty
    );

    const examsListRes = await request(app)
      .get('/api/exams')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(examsListRes.status).toBe(200);
    const createdBalanced = examsListRes.body.exams.find(
      (ex: { id: string }) => ex.id === balancedExamRes.body.id
    );
    expect(createdBalanced).toBeDefined();
    expect(createdBalanced.assemblyMeta.strategy).toBe('balanced');
    expect(createdBalanced.assemblyMeta.actualDistribution.easy + createdBalanced.assemblyMeta.actualDistribution.medium + createdBalanced.assemblyMeta.actualDistribution.hard).toBe(7);
  });

  it('系统管理员全局权限：用户治理、全站私有题库管控、使用时长心跳与注册策略审计', async () => {
    // 1. 普通成员访问任意 /api/admin/* 必须返回 403
    for (const adminPath of ['/api/admin/overview', '/api/admin/users', '/api/admin/usage', '/api/admin/banks', '/api/admin/exams', '/api/admin/audit-logs']) {
      const denyRes = await request(app)
        .get(adminPath)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(denyRes.status).toBe(403);
    }

    // 2. 管理员直接创建一名测试成员（并校验不能禁用/降级/删除当前管理员自己）
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(meRes.status).toBe(200);
    const adminId = meRes.body.user.id as string;

    const selfDisableRes = await request(app)
      .put(`/api/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isDisabled: true });
    expect(selfDisableRes.status).toBe(400);

    const selfDemoteRes = await request(app)
      .put(`/api/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'member' });
    expect(selfDemoteRes.status).toBe(400);

    const selfDeleteRes = await request(app)
      .delete(`/api/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(selfDeleteRes.status).toBe(400);

    const createTempUser = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'managed_stu_1',
        email: 'managed_stu_1@example.com',
        nickname: '受控学员一号',
        password: 'InitPass123',
        role: 'member',
      });
    expect(createTempUser.status).toBe(201);
    const tempUserId = createTempUser.body.user.id as string;

    // 受控学员登录获取 Token
    const stuLogin1 = await request(app).post('/api/auth/login').send({
      account: 'managed_stu_1',
      password: 'InitPass123',
    });
    expect(stuLogin1.status).toBe(200);
    const stuToken1 = stuLogin1.body.token as string;

    // 3. 受控学员上报使用时长心跳（general + practice + exam）
    const hb1 = await request(app)
      .post('/api/auth/heartbeat')
      .set('Authorization', `Bearer ${stuToken1}`)
      .send({ deltaSeconds: 45, mode: 'practice', path: '/practice/bank-1' });
    expect(hb1.status).toBe(200);
    expect(hb1.body.addedSeconds).toBe(45);

    const hb2 = await request(app)
      .post('/api/auth/heartbeat')
      .set('Authorization', `Bearer ${stuToken1}`)
      .send({ deltaSeconds: 30, mode: 'exam', path: '/exam/join/TEST88' });
    expect(hb2.status).toBe(200);

    const hb3 = await request(app)
      .post('/api/auth/heartbeat')
      .set('Authorization', `Bearer ${stuToken1}`)
      .send({ deltaSeconds: 20, mode: 'general', path: '/banks' });
    expect(hb3.status).toBe(200);

    // 验证管理员使用时长查询接口（summary + userRanking + 单用户 userDaily）
    const usageRes = await request(app)
      .get(`/api/admin/usage?days=7&userId=${tempUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(usageRes.status).toBe(200);
    const stuRank = usageRes.body.userRanking.find(
      (r: { userId: string }) => r.userId === tempUserId
    );
    expect(stuRank).toBeDefined();
    expect(stuRank.activeSeconds).toBe(95);
    expect(stuRank.practiceSeconds).toBe(45);
    expect(stuRank.examSeconds).toBe(30);
    expect(usageRes.body.userDaily).toBeDefined();
    expect(usageRes.body.userDaily.length).toBeGreaterThanOrEqual(1);
    expect(usageRes.body.userDaily[0].activeSeconds).toBe(95);

    // 验证总览看板聚合用户与时长统计
    const overviewRes = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.users.total).toBeGreaterThanOrEqual(3);
    expect(overviewRes.body.usage.todaySeconds).toBeGreaterThanOrEqual(95);
    expect(overviewRes.body.dailyTrend).toHaveLength(14);

    // 4. 学员新建一个未公开分享的私有题库，验证管理员具备全站题库治理与转移归属权限
    const privBankRes = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${stuToken1}`)
      .send({
        title: '学员未分享私有绝密库',
        description: '仅学员自建，用于校验管理员全站可见性与转移能力',
        category: '内部资料',
        visibility: 'private',
      });
    expect(privBankRes.status).toBe(201);
    const stuPrivBankId = privBankRes.body.id as string;

    const adminBanksRes = await request(app)
      .get(`/api/admin/banks?visibility=private&ownerId=${tempUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminBanksRes.status).toBe(200);
    const foundPriv = adminBanksRes.body.banks.find((b: { id: string }) => b.id === stuPrivBankId);
    expect(foundPriv).toBeDefined();
    expect(foundPriv.visibility).toBe('private');

    // 管理员修改该私有题库为公开并转移归属权至管理员自己，随后清理
    const transferRes = await request(app)
      .put(`/api/admin/banks/${stuPrivBankId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visibility: 'public', ownerId: adminId });
    expect(transferRes.status).toBe(200);

    const delBankRes = await request(app)
      .delete(`/api/admin/banks/${stuPrivBankId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delBankRes.status).toBe(200);

    // 5. 禁用受控学员 -> 既有 Token 与重新登录均必须被 403 拦截 -> 启用后恢复
    const disableRes = await request(app)
      .put(`/api/admin/users/${tempUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isDisabled: true });
    expect(disableRes.status).toBe(200);

    const blockedMeRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${stuToken1}`);
    expect(blockedMeRes.status).toBe(403);

    const blockedLoginRes = await request(app).post('/api/auth/login').send({
      account: 'managed_stu_1',
      password: 'InitPass123',
    });
    expect(blockedLoginRes.status).toBe(403);

    // 启用并重置密码
    const enableRes = await request(app)
      .put(`/api/admin/users/${tempUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isDisabled: false, role: 'admin' });
    expect(enableRes.status).toBe(200);

    const resetPwdRes = await request(app)
      .post(`/api/admin/users/${tempUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'NewResetPass456' });
    expect(resetPwdRes.status).toBe(200);

    const loginNewPwdRes = await request(app).post('/api/auth/login').send({
      account: 'managed_stu_1',
      password: 'NewResetPass456',
    });
    expect(loginNewPwdRes.status).toBe(200);
    expect(loginNewPwdRes.body.user.role).toBe('admin');

    // 删除临时受控用户
    const delUserRes = await request(app)
      .delete(`/api/admin/users/${tempUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delUserRes.status).toBe(200);

    // 6. 管理员关闭自助注册开关 -> 拦截外部注册 -> 重新恢复开启
    const closeRegRes = await request(app)
      .put('/api/admin/policy')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ allowRegistration: false });
    expect(closeRegRes.status).toBe(200);
    expect(closeRegRes.body.policy.allowRegistration).toBe(false);

    const bootClosed = await request(app).get('/api/auth/bootstrap-status');
    expect(bootClosed.status).toBe(200);
    expect(bootClosed.body.allowRegistration).toBe(false);

    const regBlocked = await request(app).post('/api/auth/register').send({
      username: 'blocked_new_user',
      email: 'blocked_new@example.com',
      password: 'Password123',
    });
    expect(regBlocked.status).toBe(403);

    const reopenRegRes = await request(app)
      .put('/api/admin/policy')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ allowRegistration: true });
    expect(reopenRegRes.status).toBe(200);
    expect(reopenRegRes.body.policy.allowRegistration).toBe(true);

    // 7. 审计日志校验
    const auditRes = await request(app)
      .get('/api/admin/audit-logs?limit=20')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    expect(Array.isArray(auditRes.body.logs)).toBe(true);
    const actions = auditRes.body.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain('create_user');
    expect(actions).toContain('update_bank');
    expect(actions).toContain('reset_password');
    expect(actions).toContain('delete_user');
    expect(actions).toContain('update_policy');
  });

  it('AI 评级 JSON 缺逗号/未转义双引号/截断容错恢复及分批分页入库正常', async () => {
    // 1. extractJsonObject 修复缺逗号与尾随逗号
    const repaired = extractJsonObject<{ ratings: Array<{ idx: number; difficulty: number }> }>(
      '{"ratings":[{"idx":1,"difficulty":2}{"idx":2,"difficulty":4},]}'
    );
    expect(repaired.ratings).toHaveLength(2);
    expect(repaired.ratings[1].difficulty).toBe(4);

    // 2. parseRatingItemsFromRawText 对未转义双引号 + 缺逗号 + 截断的恢复及 idx->UUID 映射
    const mockChunk = [
      { id: '11111111-1111-4111-8111-111111111111', type: 'single' as const, stem: 'Q1', options: [], answer: 'A' },
      { id: '22222222-2222-4222-8222-222222222222', type: 'single' as const, stem: 'Q2', options: [], answer: 'B' },
      { id: '33333333-3333-4333-8333-333333333333', type: 'single' as const, stem: 'Q3', options: [], answer: 'C' },
    ];
    const malformedPayload = `{"ratings":[
      {"idx":1,"difficulty":1,"starRating":5,"reason":"考察Java中"final"关键字作用"}
      {"idx":2,"difficulty":4,"starRating":4,"reason":"比较"=="与equals区别"}
      {"idx":3,"difficulty":2,"starRating":3,"reason":"未闭合截断`;

    const recovered = parseRatingItemsFromRawText(malformedPayload, mockChunk);
    expect(recovered).toHaveLength(2);
    expect(recovered[0].id).toBe('11111111-1111-4111-8111-111111111111');
    expect(recovered[0].difficulty).toBe(1);
    expect(recovered[0].starRating).toBe(5);
    expect(recovered[0].reason).toContain('final');
    expect(recovered[1].id).toBe('22222222-2222-4222-8222-222222222222');
    expect(recovered[1].difficulty).toBe(4);
    expect(recovered[1].reason).toContain('equals');

    // 3. POST /api/ai/rate-bank 支持小批次 limit + offset 分页持续评定并即时落库
    const bankRes = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'AI 分批断点续评测试库',
        category: 'Java',
        visibility: 'private',
      });
    expect(bankRes.status).toBe(201);
    const pagedBankId = bankRes.body.id as string;

    const batchAdd = await request(app)
      .post(`/api/banks/${pagedBankId}/questions/batch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        questions: [1, 2, 3, 4, 5].map((n) => ({
          type: 'single',
          stem: `Java题${n}`,
          options: [{ key: 'A', content: '正确' }, { key: 'B', content: '错误' }],
          answer: 'A',
          difficulty: 2,
        })),
      });
    expect(batchAdd.status).toBe(201);

    setAiRatingBatchRunnerForTesting(async (_cfg, batch) =>
      batch.map((q) => ({
        id: q.id,
        difficulty: 3,
        starRating: 4,
        reason: '分批已保存',
      }))
    );

    try {
      const round1 = await request(app)
        .post('/api/ai/rate-bank')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId: pagedBankId, onlyUnrated: true, limit: 2 });
      expect(round1.status).toBe(200);
      expect(round1.body.ratedCount).toBe(2);
      expect(round1.body.processedCount).toBe(2);
      expect(round1.body.remainingUnrated).toBe(3);

      const round2 = await request(app)
        .post('/api/ai/rate-bank')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId: pagedBankId, onlyUnrated: true, limit: 3 });
      expect(round2.status).toBe(200);
      expect(round2.body.ratedCount).toBe(3);
      expect(round2.body.remainingUnrated).toBe(0);

      // 全库重评 offset=3 时应处理最后 2 题
      const rerunPage = await request(app)
        .post('/api/ai/rate-bank')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bankId: pagedBankId, onlyUnrated: false, limit: 3, offset: 3 });
      expect(rerunPage.status).toBe(200);
      expect(rerunPage.body.processedCount).toBe(2);
      expect(rerunPage.body.ratedCount).toBe(2);
    } finally {
      setAiRatingBatchRunnerForTesting(null);
    }
  });

  it('部分更新 settings 传入 null 不应覆盖昵称，且支持刷题进度同步与未做筛选', async () => {
    const patchRes = await request(app)
      .put('/api/auth/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        nickname: null,
        removeAfterCorrectCount: null,
        autoNextOnCorrect: null,
        autoNextDelayMs: 450,
        switchAnimationMs: 180,
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.nickname).toBe('备考同学');
    expect(patchRes.body.user.settings.removeAfterCorrectCount).toBe(2);
    expect(patchRes.body.user.settings.autoNextOnCorrect).toBe(true);
    expect(patchRes.body.user.settings.autoNextDelayMs).toBe(450);
    expect(patchRes.body.user.settings.switchAnimationMs).toBe(180);

    // 即使数据库中存留异常 "null" 昵称，/me 与题库 ownerName 也应回退到 username
    const newBank = await request(app)
      .post('/api/banks')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ title: '进度测试题库', visibility: 'public', category: '测试' });
    expect(newBank.status).toBe(201);
    const bankId = newBank.body.id as string;

    const addQ = await request(app)
      .post(`/api/banks/${bankId}/questions/batch`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        questions: [1, 2, 3].map((n) => ({
          type: 'single',
          stem: `进度题${n}`,
          options: [
            { key: 'A', content: '对' },
            { key: 'B', content: '错' },
          ],
          answer: 'A',
          difficulty: 2,
        })),
      });
    expect(addQ.status).toBe(201);

    await db.query(`UPDATE users SET nickname = 'null' WHERE username = 'learner'`);
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.nickname).toBe('learner');

    const banksList = await request(app)
      .get('/api/banks?scope=mine')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(banksList.status).toBe(200);
    const testedBank = banksList.body.banks.find((b: { id: string }) => b.id === bankId);
    expect(testedBank?.ownerName).toBe('learner');

    // 先保存翻页断点到第 3 题 (index = 2)
    const progRes = await request(app)
      .put('/api/practice/progress')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ bankId, currentIndex: 2, mode: 'sequential' });
    expect(progRes.status).toBe(200);
    expect(progRes.body.lastQuestionIndex).toBe(2);

    // 读取会话验证 lastProgressIndex = 2 且 nextUnansweredIndex = 0
    const sessionBefore = await request(app)
      .get(`/api/practice/session?bankId=${bankId}&mode=sequential`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(sessionBefore.status).toBe(200);
    expect(sessionBefore.body.lastProgressIndex).toBe(2);
    expect(sessionBefore.body.nextUnansweredIndex).toBe(0);
    const firstQId = sessionBefore.body.questions[0].id as string;

    // 作答第 1 题后验证 record.lastAnswer 与 onlyUnanswered=true
    const ansRes = await request(app)
      .post('/api/practice/answer')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ questionId: firstQId, answer: 'A', currentIndex: 0, mode: 'sequential' });
    expect(ansRes.status).toBe(200);
    expect(ansRes.body.record.lastAnswer).toBe('A');

    const sessionAfter = await request(app)
      .get(`/api/practice/session?bankId=${bankId}&mode=sequential`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(sessionAfter.status).toBe(200);
    expect(sessionAfter.body.nextUnansweredIndex).toBe(1);
    expect(sessionAfter.body.questions[0].record.lastAnswer).toBe('A');

    const onlyUnanswered = await request(app)
      .get(`/api/practice/session?bankId=${bankId}&mode=sequential&onlyUnanswered=true`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(onlyUnanswered.status).toBe(200);
    expect(onlyUnanswered.body.questions.length).toBe(2);
  });

  it('从 GitHub 拉取最新 APK 缓存、下载流校验、SSE 实时推送更新提醒及管理员权限校验正常', async () => {
    const prevCacheDir = process.env.APP_UPDATE_CACHE_DIR;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismq-updates-'));
    process.env.APP_UPDATE_CACHE_DIR = tmpDir;

    try {
      const memberCfgRes = await request(app)
        .get('/api/app-update/admin/config')
        .set('Authorization', `Bearer ${memberToken}`);
      expect(memberCfgRes.status).toBe(403);

      const memberSyncRes = await request(app)
        .post('/api/app-update/admin/sync')
        .set('Authorization', `Bearer ${memberToken}`);
      expect(memberSyncRes.status).toBe(403);

      const updateConfigRes = await request(app)
        .put('/api/app-update/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          githubRepo: 'example-org/prismq-community',
          githubToken: 'test-github-token-123',
          enabled: true,
          pollIntervalMinutes: 10,
        });
      expect(updateConfigRes.status).toBe(200);
      expect(updateConfigRes.body.config.hasGithubToken).toBe(true);

      const fakeApkBytes = Buffer.from('PK\x03\x04prismq-test-apk-binary-payload-v2.3.0');
      let seenAuthOnRedirectedDownload = false;

      const mockFetch: typeof fetch = (async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const hdrs = (init?.headers || {}) as Record<string, string>;
        if (url === 'https://api.github.com/repos/example-org/prismq-community/releases/latest') {
          expect(hdrs.Authorization).toBe('Bearer test-github-token-123');
          return new Response(
            JSON.stringify({
              tag_name: 'v2.3.0',
              name: 'PrismQ v2.3.0',
              body: 'versionCode: 6\n新增智能更新推送',
              published_at: '2026-11-25T08:00:00Z',
              assets: [
                {
                  id: 99,
                  name: 'prismq-v2.3.0.apk',
                  url: 'https://api.github.com/repos/example-org/prismq-community/releases/assets/99',
                  size: fakeApkBytes.length,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url === 'https://api.github.com/repos/example-org/prismq-community/releases/assets/99') {
          expect(hdrs.Authorization).toBe('Bearer test-github-token-123');
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://objects.githubusercontent.com/signed/prismq.apk' },
          });
        }
        if (url === 'https://objects.githubusercontent.com/signed/prismq.apk') {
          if (hdrs.Authorization) seenAuthOnRedirectedDownload = true;
          return new Response(fakeApkBytes, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const syncRes = await syncLatestApkFromGitHub(db, {
        forcePush: true,
        fetchImpl: mockFetch,
        cacheDir: tmpDir,
      });
      expect(syncRes.ok).toBe(true);
      expect(syncRes.updated).toBe(true);
      expect(seenAuthOnRedirectedDownload).toBe(false);
      expect(syncRes.latest?.versionName).toBe('2.3.0');
      expect(syncRes.latest?.versionCode).toBe(6);

      const checkOlder = await request(app).get(
        '/api/app-update/latest?currentVersion=2.2.0&currentVersionCode=5'
      );
      expect(checkOlder.status).toBe(200);
      expect(checkOlder.body.hasUpdate).toBe(true);
      expect(checkOlder.body.latest.versionName).toBe('2.3.0');
      expect(checkOlder.body.latest.downloadUrl).toBe('/api/app-update/download');

      const checkSame = await request(app).get(
        '/api/app-update/latest?currentVersion=2.3.0&currentVersionCode=6'
      );
      expect(checkSame.status).toBe(200);
      expect(checkSame.body.hasUpdate).toBe(false);
      expect(isReleaseNewer(checkOlder.body.latest, '2.3.0', 6)).toBe(false);
      expect(compareSemver('2.3.0', '2.2.0')).toBe(1);

      const downloadRes = await request(app)
        .get('/api/app-update/download')
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('application/vnd.android.package-archive');
      expect((downloadRes.body as Buffer).equals(fakeApkBytes)).toBe(true);

      // Verify SSE stream immediately pushes `event: update` to outdated client
      const server = app.listen(0);
      try {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const sseController = new AbortController();
        const sseRes = await fetch(
          `http://127.0.0.1:${port}/api/app-update/stream?currentVersion=2.2.0&currentVersionCode=5`,
          { signal: sseController.signal }
        );
        expect(sseRes.status).toBe(200);
        const reader = sseRes.body!.getReader();
        let collected = '';
        for (let i = 0; i < 6; i += 1) {
          const { value, done } = await reader.read();
          if (value) collected += Buffer.from(value).toString('utf8');
          if (done || collected.includes('event: update')) break;
        }
        sseController.abort();
        expect(collected).toContain('event: connected');
        expect(collected).toContain('event: update');
        expect(collected).toContain('"versionName":"2.3.0"');
      } finally {
        server.close();
      }
    } finally {
      if (prevCacheDir === undefined) {
        delete process.env.APP_UPDATE_CACHE_DIR;
      } else {
        process.env.APP_UPDATE_CACHE_DIR = prevCacheDir;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
