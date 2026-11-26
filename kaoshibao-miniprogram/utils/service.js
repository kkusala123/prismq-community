/**
 * 棱题 · PrismQ · 数据层（直连本地服务器）
 *
 * 页面只调用本文件导出的函数，不直接接触 wx.request。
 * 判题、错题自动移出、连续答对阈值、断点进度、交卷评分、成绩入库
 * 全部由 web-app 的 /api/* 接口在服务端完成，小程序与网页端共用同一套
 * 业务规则和同一个 PostgreSQL 数据库，因此不存在"数据同步"问题。
 *
 * 适配仓库版本：acab389（含题库私密分享、AI 星级、难度分层、未作答模式、
 * 注册开关、均衡组卷等）。
 */
const api = require('./api');

const DEMO_USER = null;

/* ------------------ 通用工具 ------------------ */

function ready() {
    if (!api.getBaseUrl()) {
        return Promise.reject({ code: 'NO_BASE_URL', message: '服务器地址未配置，请联系维护者检查 utils/config.js' });
    }
    if (!api.getToken()) {
        return Promise.reject({ code: 'SIGN_IN_REQUIRED', message: '登录状态已失效，请重新登录' });
    }
    return Promise.resolve();
}

function normalizeQuestion(q) {
    return Object.assign({}, q, {
        record: q.record || null,
        starRating: Number(q.starRating || 0),
    });
}

function resolveShareCode(examId, shareCode) {
    if (shareCode) return Promise.resolve(String(shareCode).trim().toUpperCase());
    if (!examId) return Promise.reject({ code: 'NOT_FOUND', message: '缺少考试分享码' });

    return api.get('/api/exams').then(function (res) {
        const list = (res && res.exams) || [];
        const found = list.filter(function (e) {
            return e.id === examId;
        })[0];
        if (!found) throw { code: 'NOT_FOUND', message: '考试不存在或已关闭' };
        return String(found.shareCode || '').trim().toUpperCase();
    });
}

/* ------------------ 兼容层：会话与用户 ------------------ */

function getUser() {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.globalData && app.globalData.user) || api.getUser() || null;
}

function getToken() {
    return api.getToken();
}

function isOnline() {
    return !!api.getBaseUrl();
}

function isDemoMode() {
    return false;
}

function useLocal() {
    return false;
}

function getBaseUrl() {
    return api.getBaseUrl();
}

function applyAuth(result) {
    const token = result && result.token;
    const user = result && result.user;
    if (!token || !user) {
        throw { code: 'AUTH_FAILED', message: '登录失败，服务器未返回有效凭证' };
    }
    api.saveAuth(token, user);
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app) {
        app.resetSession();
        app.globalData.user = user;
    }
    return { token: token, user: user };
}

function getWechatCode() {
    return new Promise(function (resolve, reject) {
        if (typeof wx === 'undefined' || !wx.login) {
            reject({ code: 'WX_LOGIN_UNAVAILABLE', message: '当前环境不支持微信登录' });
            return;
        }
        // 与 api.request 同样的兜底策略：某些沙箱里 wx.login 可能既不 success 也不 fail
        let settled = false;
        const timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            reject({ code: 'WX_LOGIN_TIMEOUT', message: '获取微信登录凭证超时，请重试' });
        }, 10000);
        function done(fn, payload) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(payload);
        }
        wx.login({
            success: function (res) {
                const code = res && res.code;
                if (!code) {
                    done(reject, { code: 'WX_LOGIN_NO_CODE', message: '微信未返回登录凭证，请重试' });
                    return;
                }
                done(resolve, code);
            },
            fail: function (err) {
                done(reject, {
                    code: 'WX_LOGIN_FAIL',
                    message: '微信登录失败：' + String((err && err.errMsg) || '未知错误'),
                });
            },
        });
    });
}

/**
 * 微信一键登录：wx.login 拿 code -> 服务端换 openid -> 签发与网站账号同构的 JWT。
 * 首次登录由服务端自动建号；响应结构与账号密码登录一致，复用 applyAuth。
 */
function wechatLogin() {
    return getWechatCode()
        .then(function (code) {
            return api.post('/api/auth/wechat-login', { code: code }, { anonymous: true });
        })
        .then(applyAuth);
}

function login(account, password) {
    return api
        .post('/api/auth/login', { account: account, password: password }, { anonymous: true })
        .then(applyAuth);
}

function register(payload) {
    const p = payload || {};
    return api
        .post(
            '/api/auth/register',
            {
                username: p.username || p.account || '',
                email: p.email || '',
                password: p.password || '',
                nickname: p.nickname || '',
            },
            { anonymous: true }
        )
        .then(applyAuth);
}

function loginDemo() {
    return Promise.reject({ code: 'NO_DEMO', message: '当前为服务器直连模式，请使用网站账号登录' });
}

function fetchMe() {
    return ready()
        .then(function () {
            return api.get('/api/auth/me');
        })
        .then(function (res) {
            if (res && res.user) api.setUser(res.user);
            return res;
        });
}

function updateSettings(payload) {
    return ready()
        .then(function () {
            return api.put('/api/auth/settings', payload || {});
        })
        .then(function (res) {
            if (res && res.user) {
                api.setUser(res.user);
                const app = typeof getApp === 'function' ? getApp() : null;
                if (app && app.globalData) {
                    app.globalData.user = res.user;
                }
            }
            return res;
        });
}

function logout() {
    api.clearAuth();
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app) app.resetSession();
    return Promise.resolve();
}

function getLastReport() {
    return null;
}

function saveLocalSubmission() {
    // 成绩由服务端 /api/exams/join/:code/submit 直接入库，无需本地保存
}

/* ------------------ 首页概览 ------------------ */

function fetchDashboard() {
    return ready()
        .then(function () {
            return api.get('/api/practice/dashboard');
        })
        .then(function (res) {
            return Object.assign({ demo: false }, res || {});
        });
}

/* ------------------ 题库 ------------------ */

function fetchBanks(params) {
    const p = params || {};
    return ready()
        .then(function () {
            return api.get('/api/banks', {
                scope: p.scope || 'all',
                category: p.category || '',
                q: p.q || '',
            });
        })
        .then(function (res) {
            return { banks: (res && res.banks) || [] };
        });
}

function fetchBankDetail(bankId) {
    return ready()
        .then(function () {
            return api.get('/api/banks/' + encodeURIComponent(bankId));
        })
        .then(function (res) {
            if (!res || !res.bank) return null;
            const chapters = res.chapters || [];
            const questions = (res.questions || []).map(normalizeQuestion);
            const bank = Object.assign({}, res.bank, {
                questionCount: questions.length,
                chapterCount: chapters.length,
            });
            return {
                bank: bank,
                chapters: chapters,
                questions: questions,
                stats: res.stats || null,
                demo: false,
            };
        });
}

/* 私密题库分享：查询预览与加入 */
function fetchSharedBank(code) {
    return ready()
        .then(function () {
            return api.get('/api/banks/share/' + encodeURIComponent(String(code || '').trim().toUpperCase()));
        })
        .then(function (res) {
            return { bank: (res && res.bank) || null };
        });
}

function joinSharedBank(code, password) {
    return ready()
        .then(function () {
            return api.post('/api/banks/share/join', {
                shareCode: String(code || '').trim().toUpperCase(),
                password: password || '',
            });
        });
}

/* ------------------ 练习会话 ------------------ */

function fetchSession(params) {
    const p = params || {};
    return ready()
        .then(function () {
            return api.get('/api/practice/session', {
                bankId: p.bankId || '',
                mode: p.mode || 'sequential',
                sortBy: p.sortBy || '',
                chapterId: p.chapterId || '',
                type: p.type || '',
                difficultyTier: p.difficultyTier || '',
                minStar: p.minStar || '',
                onlyUnanswered: p.onlyUnanswered ? 'true' : '',
                excludeMastered: p.excludeMastered ? 'true' : '',
                shuffleQuestions: p.shuffleQuestions ? 'true' : '',
            });
        })
        .then(function (res) {
            const questions = ((res && res.questions) || []).map(normalizeQuestion);
            return {
                questions: questions,
                lastProgressIndex: Number((res && res.lastProgressIndex) || 0),
                nextUnansweredIndex: Number((res && res.nextUnansweredIndex) || 0),
                total: Number((res && res.total) || questions.length),
                shuffled: !!(res && res.shuffled),
                shuffleSeed: (res && res.shuffleSeed) || '',
                mode: p.mode || 'sequential',
                demo: false,
            };
        });
}

function formatBankCode(bankId) {
    return ready().then(function () {
        return api.post('/api/banks/' + encodeURIComponent(bankId) + '/format-code', {});
    });
}

function fetchBankShareQr(bankId) {
    return ready().then(function () {
        return api.get('/api/banks/' + encodeURIComponent(bankId) + '/share-qrcode');
    });
}

/* 显式保存断点进度（与 submitAnswer 的隐式保存互补） */
function saveProgress(bankId, currentIndex, mode) {
    return ready()
        .then(function () {
            return api.put('/api/practice/progress', {
                bankId: bankId,
                currentIndex: currentIndex,
                mode: mode || 'sequential',
            });
        })
        .catch(function (err) {
            // 兼容尚未部署仓库 c732732 的服务端：该提交才引入 PUT /progress。
            // 旧端点返回 404 时静默降级，作答接口本身会隐式保存断点，不阻断刷题。
            if (err && (err.code === 'HTTP_404' || err.code === 'HTTP_405')) {
                return { ok: false, unsupported: true };
            }
            throw err;
        });
}

function resetProgress(payload) {
    if (useLocal()) {
        return Promise.resolve({ ok: true, resetCount: 0, lastQuestionIndex: 0 });
    }
    const p = payload || {};
    return ready().then(function () {
        const body = {
            bankId: p.bankId || '',
            mode: p.mode || 'sequential',
        };
        if (Array.isArray(p.questionIds) && p.questionIds.length) {
            body.questionIds = p.questionIds;
        }
        return api.post('/api/practice/reset', body);
    });
}

/* ------------------ 作答与收藏 ------------------ */

function submitAnswer(payload) {
    const p = payload || {};
    return ready().then(function () {
        return api.post('/api/practice/answer', {
            questionId: p.questionId,
            answer: p.answer,
            currentIndex: p.currentIndex,
            mode: p.mode || 'sequential',
        });
    });
}

function toggleQuestion(payload) {
    const p = payload || {};
    return ready().then(function () {
        const body = { questionId: p.questionId, action: p.action };
        if (p.value !== undefined) body.value = p.value;
        return api.post('/api/practice/toggle', body);
    });
}

/* ------------------ 错题与收藏 ------------------ */

function fetchMistakes() {
    return ready()
        .then(function () {
            return Promise.all([
                api.get('/api/practice/mistakes', { tab: 'mistakes' }),
                api.get('/api/practice/mistakes', { tab: 'favorites' }),
            ]);
        })
        .then(function (res) {
            return {
                mistakes: ((res[0] && res[0].items) || []).map(normalizeQuestion),
                favorites: ((res[1] && res[1].items) || []).map(normalizeQuestion),
                demo: false,
            };
        });
}

/* ------------------ 考试 ------------------ */

function fetchExams() {
    return ready()
        .then(function () {
            return api.get('/api/exams');
        })
        .then(function (res) {
            return {
                exams: (res && res.exams) || [],
                submissions: (res && res.submissions) || [],
                demo: false,
            };
        });
}

function fetchExamPaper(examId, shareCode, password) {
    return ready()
        .then(function () {
            return resolveShareCode(examId, shareCode);
        })
        .then(function (code) {
            return api.get('/api/exams/join/' + encodeURIComponent(code), {
                password: password || '',
            });
        })
        .then(function (res) {
            const data = res || {};
            return {
                requiresPassword: !!data.requiresPassword,
                requiresLogin: !!data.requiresLogin,
                exam: data.exam || null,
                questions: data.questions || [],
                demo: false,
            };
        });
}

function createExam(payload) {
    return ready().then(function () {
        return api.post('/api/exams', payload || {});
    });
}

function startExamSession(shareCode, body) {
    return ready().then(function () {
        return api.post('/api/exams/join/' + encodeURIComponent(shareCode) + '/start', body || {});
    });
}

function heartbeatExam(shareCode, body) {
    return ready().then(function () {
        return api.post('/api/exams/join/' + encodeURIComponent(shareCode) + '/heartbeat', body || {});
    });
}

function terminateExam(examId) {
    return ready().then(function () {
        return api.post('/api/exams/' + encodeURIComponent(examId) + '/terminate', {});
    });
}

function fetchExamAnalytics(examId) {
    return ready().then(function () {
        return api.get('/api/exams/' + encodeURIComponent(examId) + '/analytics');
    });
}

function fetchExamShareQr(examId) {
    return ready().then(function () {
        return api.get('/api/exams/' + encodeURIComponent(examId) + '/qrcode');
    });
}

function submitExam(payload) {
    const p = payload || {};
    return ready()
        .then(function () {
            return resolveShareCode(p.examId, p.shareCode);
        })
        .then(function (code) {
            const body = {
                answers: p.answers || {},
                durationSeconds: Math.max(0, Number(p.durationSeconds) || 0),
                tabSwitchCount: Math.max(0, Number(p.tabSwitchCount) || 0),
                participantName: p.participantName || '',
                startedAt: p.startedAt || new Date().toISOString(),
            };
            if (p.sessionId) body.sessionId = p.sessionId;
            if (Array.isArray(p.cheatEvents) && p.cheatEvents.length) body.cheatEvents = p.cheatEvents;
            if (p.deviceInfo) body.deviceInfo = p.deviceInfo;
            if (p.accessPassword) body.accessPassword = p.accessPassword;
            return api.post('/api/exams/join/' + encodeURIComponent(code) + '/submit', body);
        })
        .then(function (res) {
            return { submission: (res && res.submission) || null, demo: false };
        });
}

function fetchReport(submissionId) {
    return ready()
        .then(function () {
            if (submissionId) {
                return api.get('/api/exams/submissions/' + encodeURIComponent(submissionId));
            }
            return api.get('/api/exams').then(function (res) {
                const list = (res && res.submissions) || [];
                if (!list.length) return {};
                return api.get('/api/exams/submissions/' + encodeURIComponent(list[0].id));
            });
        })
        .then(function (res) {
            return {
                submission: (res && res.submission) || null,
                questions: (res && res.questions) || [],
                demo: false,
            };
        });
}

function explainQuestion(payload) {
    if (useLocal()) {
        return Promise.reject(new Error('请先登录后使用 AI 一键解析'));
    }
    const p = payload || {};
    return ready().then(function () {
        const body = {
            userAnswer: p.userAnswer || '',
            saveToQuestion: !!p.saveToQuestion,
        };
        if (p.questionId) body.questionId = p.questionId;
        if (p.type) body.type = p.type;
        if (p.stem) body.stem = p.stem;
        if (Array.isArray(p.options)) body.options = p.options;
        if (p.answer !== undefined && p.answer !== null) body.answer = String(p.answer);
        if (p.explanation) body.explanation = p.explanation;
        return api.post('/api/ai/explain', body, { timeout: 65000 });
    });
}

module.exports = {
    DEMO_USER: DEMO_USER,
    isOnline: isOnline,
    isDemoMode: isDemoMode,
    useLocal: useLocal,
    getBaseUrl: getBaseUrl,
    testConnection: function () {
        return api.testConnection();
    },
    getUser: getUser,
    getToken: getToken,
    login: login,
    loginDemo: loginDemo,
    register: register,
    fetchMe: fetchMe,
    updateSettings: updateSettings,
    logout: logout,
    fetchDashboard: fetchDashboard,
    fetchBanks: fetchBanks,
    fetchBankDetail: fetchBankDetail,
    formatBankCode: formatBankCode,
    fetchBankShareQr: fetchBankShareQr,
    fetchSharedBank: fetchSharedBank,
    joinSharedBank: joinSharedBank,
    fetchSession: fetchSession,
    saveProgress: saveProgress,
    resetProgress: resetProgress,
    submitAnswer: submitAnswer,
    toggleQuestion: toggleQuestion,
    fetchMistakes: fetchMistakes,
    fetchExams: fetchExams,
    createExam: createExam,
    fetchExamPaper: fetchExamPaper,
    startExamSession: startExamSession,
    heartbeatExam: heartbeatExam,
    terminateExam: terminateExam,
    fetchExamAnalytics: fetchExamAnalytics,
    fetchExamShareQr: fetchExamShareQr,
    submitExam: submitExam,
    fetchReport: fetchReport,
    explainQuestion: explainQuestion,
    getLastReport: getLastReport,
    saveLocalSubmission: saveLocalSubmission,
    wechatLogin: wechatLogin,
};
