const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');
const codeFormat = require('../../utils/codeFormat');

const RISK_LABELS = {
    emulator: '虚拟机/模拟器环境',
    emulator_or_vm: '虚拟机/模拟器环境',
    debugger: '调试模式',
    virtual_space: '多开/分身环境',
    multi_window: '分屏/多窗模式',
    small_window: '小窗/分屏行为',
    tab_switch: '切屏离开',
    focus_lost: '窗口失焦',
    window_blur: '窗口失焦',
    devtools: '调试工具',
    screenshot: '截屏记录',
    terminated_by_creator: '组织者主动终结并收卷',
    excess_tab_switches: '切屏超限自动收卷',
};

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        submission: null,
        items: [],
        summary: {
            score: 0,
            totalScore: 0,
            passScore: 0,
            isPassed: false,
            correctCount: 0,
            totalQuestions: 0,
            accuracy: 0,
            durationText: '00:00',
            tabSwitchCount: 0,
            examTitle: '',
        },
        scoreText: '0',
        passText: '',
    },

    onLoad(options) {
        const id = (options && options.submissionId) || '';
        this.reportId = id;
        this.pendingLoad = true;
    },

    onShow() {
        this.restore();
    },

    restore() {
        auth.restore(this, () => this.loadIfPending());
    },

    onSignedIn() {
        this.pendingLoad = true;
        auth.signedIn(this, () => this.loadIfPending());
    },

    loadIfPending() {
        if (!this.pendingLoad) return;
        this.pendingLoad = false;
        this.load(this.reportId);
    },

    clearSignedOutData() {
        this.pendingLoad = false;
        this.setData({ submission: null, items: [], errorText: '' });
    },

    load(submissionId) {
        this.setData({ loading: true, errorText: '' });

        service
            .fetchReport(submissionId)
            .then((res) => {
                const sub = (res && res.submission) || null;
                if (!sub) {
                    this.setData({ loading: false, errorText: '未找到成绩记录' });
                    return;
                }

                const totalQ = Number(sub.totalQuestions) || 0;
                const correct = Number(sub.correctCount) || 0;
                const riskLabels = (Array.isArray(sub.riskFlags) ? sub.riskFlags : []).map((f) => RISK_LABELS[f] || f);
                const summary = {
                    score: Number(sub.score) || 0,
                    totalScore: Number(sub.totalScore) || 0,
                    passScore: Number(sub.passScore) || 0,
                    isPassed: !!sub.isPassed,
                    correctCount: correct,
                    totalQuestions: totalQ,
                    accuracy:
                        sub.accuracy !== undefined && sub.accuracy !== null
                            ? Number(sub.accuracy)
                            : totalQ > 0
                            ? Math.round((correct / totalQ) * 100)
                            : 0,
                    durationText: util.formatDuration(sub.durationSeconds),
                    tabSwitchCount: Number(sub.tabSwitchCount) || 0,
                    examTitle: sub.examTitle || '考试成绩',
                    terminatedByCreator: !!sub.terminatedByCreator,
                    riskLabels: riskLabels,
                };

                this.setData({
                    submission: sub,
                    summary: summary,
                    scoreText: String(summary.score),
                });

                this.loadQuestions(sub);
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '成绩加载失败' });
            });
    },

    loadQuestions(sub) {
        const detail = sub.gradingDetail || {};

        service
            .fetchExamPaper(sub.examId, sub.shareCode)
            .then((paper) => {
                const questions = (paper && paper.questions) || [];
                const items = questions.map((q, i) => {
                    const d = detail[q.questionId] || {};
                    return {
                        no: i + 1,
                        questionId: q.questionId || '',
                        type: q.type || 'single',
                        options: q.options || [],
                        rawAnswer: q.answer || '',
                        stem: q.stem,
                        stemSegments: codeFormat.parseRichSegments(q.stem),
                        typeLabel: util.TYPE_LABELS[q.type] || '题目',
                        isCorrect: !!d.isCorrect,
                        userAnswer: d.userAnswer || '未作答',
                        correctAnswer: d.correctAnswer || '',
                        explanation: d.explanation || '',
                        explainSegments: codeFormat.parseRichSegments(d.explanation || ''),
                        earned: Number(d.earnedScore) || 0,
                        maxScore: Number(d.maxScore) || 0,
                        aiLoading: false,
                        aiError: '',
                        aiExplain: null,
                        aiAnalysisSegments: [],
                    };
                });
                this.setData({ loading: false, items: items });
            })
            .catch(() => {
                // 试卷不可用时，至少展示评分明细里有记录的题目
                const items = Object.keys(detail).map((qid, i) => {
                    const d = detail[qid];
                    return {
                        no: i + 1,
                        questionId: qid,
                        type: 'single',
                        options: [],
                        rawAnswer: d.correctAnswer || '',
                        stem: '题目 ' + (i + 1),
                        stemSegments: codeFormat.parseRichSegments('题目 ' + (i + 1)),
                        typeLabel: '题目',
                        isCorrect: !!d.isCorrect,
                        userAnswer: d.userAnswer || '未作答',
                        correctAnswer: d.correctAnswer || '',
                        explanation: d.explanation || '',
                        explainSegments: codeFormat.parseRichSegments(d.explanation || ''),
                        earned: Number(d.earnedScore) || 0,
                        maxScore: Number(d.maxScore) || 0,
                        aiLoading: false,
                        aiError: '',
                        aiExplain: null,
                        aiAnalysisSegments: [],
                    };
                });
                this.setData({ loading: false, items: items });
            });
    },

    askItemAiExplain(e) {
        const index = Number(e.currentTarget.dataset.index);
        const item = this.data.items[index];
        if (!item || item.aiLoading) return;

        const prefix = 'items[' + index + '].';
        const loadingPatch = {};
        loadingPatch[prefix + 'aiLoading'] = true;
        loadingPatch[prefix + 'aiError'] = '';
        this.setData(loadingPatch);

        service
            .explainQuestion({
                questionId: item.questionId || undefined,
                userAnswer: item.userAnswer === '未作答' ? '' : item.userAnswer,
                saveToQuestion: false,
                type: item.type,
                stem: item.stem,
                options: item.options || [],
                answer: item.correctAnswer || item.rawAnswer || '',
                explanation: item.explanation || '',
            })
            .then((res) => {
                const aiRes = {
                    keyPoint: (res && res.keyPoint) || '',
                    analysis: (res && res.analysis) || '',
                    mnemonic: (res && res.mnemonic) || '',
                };
                const donePatch = {};
                donePatch[prefix + 'aiLoading'] = false;
                donePatch[prefix + 'aiExplain'] = aiRes;
                donePatch[prefix + 'aiAnalysisSegments'] = aiRes.analysis
                    ? codeFormat.parseRichSegments(aiRes.analysis)
                    : [];
                this.setData(donePatch);
            })
            .catch((err) => {
                const msg = (err && err.message) || 'AI 解析生成失败';
                const errPatch = {};
                errPatch[prefix + 'aiLoading'] = false;
                errPatch[prefix + 'aiError'] = msg;
                this.setData(errPatch);
                wx.showToast({ title: msg, icon: 'none' });
            });
    },

    copyCodeBlock(e) {
        const code = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code) || '';
        if (!code) return;
        wx.setClipboardData({
            data: code,
            success: () => wx.showToast({ title: '已复制代码', icon: 'success' }),
        });
    },

    goExams() {
        wx.switchTab({ url: '/pages/exams/exams' });
    },

    goHome() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
