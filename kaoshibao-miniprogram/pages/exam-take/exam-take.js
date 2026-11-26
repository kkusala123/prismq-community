const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');
const codeFormat = require('../../utils/codeFormat');

const EMULATOR_RE = /emulator|sdk_gphone|genymotion|bluestacks|nox|mumu|ldplayer|virtualbox|vbox|andy|droid4x|goldfish|ranchu/i;

function inspectMiniDevice() {
    let device = {};
    let win = {};
    let appBase = {};
    try {
        device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    } catch (e) {}
    try {
        win = wx.getWindowInfo ? wx.getWindowInfo() : device;
    } catch (e) {}
    try {
        appBase = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
    } catch (e) {}

    const platform = String(device.platform || '').toLowerCase();
    const brand = String(device.brand || '');
    const model = String(device.model || '');
    const sys = String(device.system || '');
    const reasons = [];

    const isDevtools = platform === 'devtools';
    const isEmuPattern = EMULATOR_RE.test(brand + ' ' + model + ' ' + sys);
    if (isDevtools) reasons.push('devtools_environment');
    if (isEmuPattern) reasons.push('emulator_model_match');

    const sw = Number(win.screenWidth) || Number(device.screenWidth) || 0;
    const sh = Number(win.screenHeight) || Number(device.screenHeight) || 0;
    const ww = Number(win.windowWidth) || Number(device.windowWidth) || 0;
    const wh = Number(win.windowHeight) || Number(device.windowHeight) || 0;
    const isMultiWindow =
        sw > 0 && sh > 0 && ww > 0 && wh > 0 && (ww < sw * 0.78 || wh < sh * 0.72);
    if (isMultiWindow) {
        reasons.push('small_window:' + Math.round(ww) + 'x' + Math.round(wh) + '/' + Math.round(sw) + 'x' + Math.round(sh));
    }

    return {
        platform: 'miniprogram-' + (platform || 'unknown'),
        deviceLabel: (brand + ' ' + model).trim() || (appBase.host ? appBase.host.appId : 'WeChat MiniProgram'),
        isEmulator: isDevtools || isEmuPattern,
        isDebugged: !!appBase.enableDebug,
        isVirtualSpace: false,
        isMultiWindow: isMultiWindow,
        reasons: reasons,
    };
}

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        examId: '',
        shareCode: '',
        exam: null,
        sessionId: '',
        questions: [],
        total: 0,
        index: 0,
        current: null,
        stemSegments: [],
        currentOptions: [],
        currentAnswer: '',
        typeLabel: '',
        answers: {},
        cardItems: [],
        showCard: false,
        answeredCount: 0,
        remainingSeconds: 0,
        timeText: '--:--',
        timeWarn: false,
        submitted: false,
        submitting: false,
        tabSwitchCount: 0,
        cheatEvents: [],
        deviceInfo: null,
        proctorWarnText: '',
        startedAt: '',
    },

    timer: null,
    heartbeatTimer: null,
    resizeHandler: null,
    captureHandler: null,
    lastSmallWinAt: 0,

    onLoad(options) {
        const opts = options || {};
        this.setData({
            examId: opts.examId || '',
            shareCode: opts.shareCode || '',
            startedAt: new Date().toISOString(),
        });
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
        this.loadPaper();
    },

    clearSignedOutData() {
        this.pendingLoad = false;
        this.clearAllTimers();
        this.setData({ questions: [], total: 0, current: null, errorText: '' });
    },

    onHide() {
        if (this.data.submitted || this.data.loading || this.data.errorText || !this.data.exam) return;
        if (this.data.exam.strictAntiCheat === false) return;
        this.recordCheat('tab_switch', '考试期间离开微信/小程序切至后台', true);
    },

    onUnload() {
        this.clearAllTimers();
    },

    clearTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },

    clearAllTimers() {
        this.clearTimer();
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.resizeHandler && typeof wx.offWindowResize === 'function') {
            try { wx.offWindowResize(this.resizeHandler); } catch (e) {}
            this.resizeHandler = null;
        }
        if (this.captureHandler && typeof wx.offUserCaptureScreen === 'function') {
            try { wx.offUserCaptureScreen(this.captureHandler); } catch (e) {}
            this.captureHandler = null;
        }
    },

    recordCheat(type, detail, countViolation) {
        if (this.data.submitted || !this.data.exam) return;
        const ev = { type: type, detail: detail, timestamp: new Date().toISOString() };
        const events = this.data.cheatEvents.concat([ev]);
        const nextSwitch = countViolation ? this.data.tabSwitchCount + 1 : this.data.tabSwitchCount;
        this.setData({
            cheatEvents: events,
            tabSwitchCount: nextSwitch,
            proctorWarnText: detail,
        });

        const exam = this.data.exam;
        if (
            countViolation &&
            exam &&
            exam.autoSubmitOnCheat !== false &&
            nextSwitch > Number(exam.maxTabSwitches || 5)
        ) {
            wx.showModal({
                title: '违规次数已达上限',
                content: '检测到多次离开考场/分屏小窗等异常操作，系统将自动为您交卷。',
                showCancel: false,
                confirmText: '确定',
                success: () => {
                    this.doSubmit(true);
                },
            });
        }
    },

    attachAntiCheatMonitors() {
        if (!this.data.exam || this.data.exam.strictAntiCheat === false) return;
        if (!this.resizeHandler && typeof wx.onWindowResize === 'function') {
            this.resizeHandler = (res) => {
                if (this.data.submitted || !this.data.exam) return;
                const size = (res && res.size) || {};
                const ww = Number(size.windowWidth) || 0;
                const wh = Number(size.windowHeight) || 0;
                let sw = 0;
                let sh = 0;
                try {
                    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
                    sw = Number(win.screenWidth) || 0;
                    sh = Number(win.screenHeight) || 0;
                } catch (e) {}
                if (sw > 0 && sh > 0 && ww > 0 && wh > 0 && (ww < sw * 0.78 || wh < sh * 0.72)) {
                    const now = Date.now();
                    if (now - this.lastSmallWinAt > 2500) {
                        this.lastSmallWinAt = now;
                        wx.showToast({ title: '检测到分屏/小窗状态，已记入监考日志', icon: 'none' });
                        this.recordCheat(
                            'small_window',
                            '窗口缩放/浮窗模式 (' + Math.round(ww) + 'x' + Math.round(wh) + ')',
                            true
                        );
                    }
                }
            };
            try { wx.onWindowResize(this.resizeHandler); } catch (e) {}
        }

        if (!this.captureHandler && typeof wx.onUserCaptureScreen === 'function') {
            this.captureHandler = () => {
                if (this.data.submitted || !this.data.exam) return;
                wx.showToast({ title: '考试禁止截屏，行为已记录', icon: 'none' });
                this.recordCheat('screenshot', '考生触发屏幕截图', false);
            };
            try { wx.onUserCaptureScreen(this.captureHandler); } catch (e) {}
        }
    },

    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.data.submitted || !this.data.shareCode) return;
            service
                .heartbeatExam(this.data.shareCode, {
                    sessionId: this.data.sessionId,
                    answers: this.data.answers,
                    tabSwitchCount: this.data.tabSwitchCount,
                    cheatEvents: this.data.cheatEvents,
                    deviceInfo: this.data.deviceInfo,
                })
                .then((res) => {
                    if (!res) return;
                    if (res.terminated || res.forceSubmitted || res.examStatus === 'closed') {
                        this.clearAllTimers();
                        this.setData({ submitted: true });
                        wx.showModal({
                            title: '考试已结束',
                            content: '组织者已终结本场考试或超时强制收卷，系统已自动结算提交。',
                            showCancel: false,
                            confirmText: '查看成绩',
                            success: () => {
                                if (res.submissionId) {
                                    wx.redirectTo({ url: '/pages/report/report?submissionId=' + res.submissionId });
                                } else {
                                    wx.switchTab({ url: '/pages/exams/exams' });
                                }
                            },
                        });
                    }
                })
                .catch(function () {});
        }, 6000);
    },

    loadPaper() {
        this.setData({ loading: true, errorText: '' });
        const dev = inspectMiniDevice();
        this.setData({ deviceInfo: dev });

        service
            .fetchExamPaper(this.data.examId, this.data.shareCode)
            .then((res) => {
                if (!res || !res.exam) {
                    throw new Error('考试不存在或已关闭');
                }
                if (res.requiresPassword) {
                    throw new Error('本场考试需要口令，请在网页端或联系组织者获取口令后参加');
                }
                if (res.requiresLogin) {
                    throw new Error('本场考试要求登录账号后参加，请返回登录');
                }

                const exam = res.exam;
                const list = res.questions || [];
                const resolvedCode = this.data.shareCode || exam.shareCode;

                if (exam.status === 'closed') {
                    throw new Error('本场考试已由组织者终结或已截止');
                }
                if (dev.isMultiWindow && exam.strictAntiCheat !== false) {
                    throw new Error('检测到当前处于小窗或分屏模式，请全屏打开小程序后重进考场');
                }

                const user = service.getUser();
                return service
                    .startExamSession(resolvedCode, {
                        participantName: (user && user.nickname) || '',
                        deviceInfo: dev,
                    })
                    .then((startRes) => {
                        const effectiveSec =
                            startRes && Number(startRes.effectiveDurationSeconds) > 0
                                ? Math.min(Number(exam.durationMinutes) * 60, Number(startRes.effectiveDurationSeconds))
                                : Math.max(0, Number(exam.durationMinutes) * 60);

                        this.setData({
                            loading: false,
                            exam: exam,
                            shareCode: resolvedCode,
                            sessionId: (startRes && startRes.sessionId) || '',
                            questions: list,
                            total: list.length,
                            index: 0,
                            remainingSeconds: effectiveSec,
                        });

                        this.startTimer();
                        this.attachAntiCheatMonitors();
                        this.startHeartbeat();
                        this.buildView();
                    });
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '试卷加载失败' });
            });
    },

    startTimer() {
        this.clearTimer();
        this.updateTimeText(this.data.remainingSeconds);
        this.timer = setInterval(() => {
            const next = this.data.remainingSeconds - 1;
            if (next <= 0) {
                this.clearTimer();
                this.setData({ remainingSeconds: 0 });
                this.updateTimeText(0);
                this.autoSubmit();
                return;
            }
            this.setData({ remainingSeconds: next });
            this.updateTimeText(next);
        }, 1000);
    },

    updateTimeText(seconds) {
        this.setData({
            timeText: util.formatDuration(seconds),
            timeWarn: seconds <= 300,
        });
    },

    buildView() {
        const list = this.data.questions;
        const index = this.data.index;
        const q = list[index];

        if (!q) {
            this.setData({ current: null });
            return;
        }

        const answerStr = String(this.data.answers[q.questionId] || '');
        const options = (q.options || []).map((o) => {
            return {
                key: o.key,
                content: o.content,
                selected: answerStr.indexOf(o.key) >= 0,
            };
        });

        const cardItems = list.map((qq, i) => {
            const has = String(this.data.answers[qq.questionId] || '').length > 0;
            return { no: i + 1, answered: has, current: i === index, index: i };
        });

        this.setData({
            current: q,
            stemSegments: codeFormat.parseRichSegments(q.stem),
            currentOptions: options,
            currentAnswer: answerStr,
            typeLabel: util.TYPE_LABELS[q.type] || '题目',
            cardItems: cardItems,
            answeredCount: Object.keys(this.data.answers).filter((k) => String(this.data.answers[k]).length > 0).length,
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

    tapOption(e) {
        if (this.data.submitted) return;
        const q = this.data.current;
        if (!q) return;

        const key = e.currentTarget.dataset.key;
        const answers = Object.assign({}, this.data.answers);

        if (q.type === 'multiple') {
            const arr = String(answers[q.questionId] || '').split('');
            const pos = arr.indexOf(key);
            if (pos >= 0) {
                arr.splice(pos, 1);
            } else {
                arr.push(key);
            }
            arr.sort();
            answers[q.questionId] = arr.join('');
        } else {
            answers[q.questionId] = key;
        }

        this.setData({ answers: answers });
        this.buildView();
    },

    onFillInput(e) {
        if (this.data.submitted) return;
        const q = this.data.current;
        if (!q) return;
        const answers = Object.assign({}, this.data.answers);
        answers[q.questionId] = e.detail.value;
        this.setData({ answers: answers, currentAnswer: e.detail.value });
    },

    prevQuestion() {
        if (this.data.index <= 0) {
            wx.showToast({ title: '已经是第一题', icon: 'none' });
            return;
        }
        this.setData({ index: this.data.index - 1 });
        this.buildView();
    },

    nextQuestion() {
        if (this.data.index >= this.data.total - 1) {
            this.confirmSubmit();
            return;
        }
        this.setData({ index: this.data.index + 1 });
        this.buildView();
    },

    openCard() {
        this.setData({ showCard: true });
    },

    closeCard() {
        this.setData({ showCard: false });
    },

    noop() {},

    goBack() {
        wx.navigateBack({ delta: 1 });
    },

    jumpTo(e) {
        this.setData({ index: Number(e.currentTarget.dataset.index), showCard: false });
        this.buildView();
    },

    confirmSubmit() {
        const answered = this.data.cardItems.filter(function (c) {
            return c.answered;
        }).length;
        const left = this.data.total - answered;

        wx.showModal({
            title: '确认交卷',
            content: left > 0 ? '还有 ' + left + ' 题未作答，确认交卷吗？' : '全部题目已作答，确认交卷吗？',
            confirmText: '交卷',
            cancelText: '再检查',
            success: (res) => {
                if (res.confirm) this.doSubmit(false);
            },
        });
    },

    autoSubmit() {
        if (this.data.submitted) return;
        wx.showModal({
            title: '考试时间到',
            content: '系统将自动为你交卷。',
            showCancel: false,
            confirmText: '知道了',
            success: () => {
                this.doSubmit(true);
            },
        });
    },

    doSubmit(isAuto) {
        if (this.data.submitted || this.data.submitting) return;

        this.clearAllTimers();
        this.setData({ submitting: true });

        const duration =
            Number(this.data.exam.durationMinutes) * 60 - this.data.remainingSeconds;

        service
            .submitExam({
                examId: this.data.examId,
                shareCode: this.data.shareCode,
                sessionId: this.data.sessionId,
                exam: this.data.exam,
                answers: this.data.answers,
                durationSeconds: Math.max(0, duration),
                tabSwitchCount: this.data.tabSwitchCount,
                cheatEvents: this.data.cheatEvents,
                deviceInfo: this.data.deviceInfo,
                participantName: (service.getUser() && service.getUser().nickname) || '',
                startedAt: this.data.startedAt,
            })
            .then((res) => {
                this.setData({ submitted: true, submitting: false });
                const sub = (res && res.submission) || null;
                const id = sub ? sub.id : '';
                wx.redirectTo({ url: '/pages/report/report?submissionId=' + id });
            })
            .catch((err) => {
                this.setData({ submitting: false });
                wx.showModal({
                    title: '交卷失败',
                    content: (err && err.message) || '网络异常，请稍后重试',
                    showCancel: false,
                });
            });
    },
});
