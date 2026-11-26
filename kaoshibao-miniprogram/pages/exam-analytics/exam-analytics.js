const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

const RISK_LABELS = {
    emulator: '虚拟机/模拟器',
    emulator_or_vm: '虚拟机/模拟器',
    debugger: '调试模式',
    virtual_space: '多开/分身',
    multi_window: '分屏/多窗',
    small_window: '小窗/分屏',
    tab_switch: '切屏',
    focus_lost: '失焦切换',
    window_blur: '失焦',
    devtools: '调试工具',
    screenshot: '截屏',
    terminated_by_creator: '管理员终结',
    excess_tab_switches: '切屏超限',
};

function mapRiskLabels(flags) {
    return (Array.isArray(flags) ? flags : []).map(function (f) {
        return RISK_LABELS[f] || f;
    });
}

Page({
    data: {
        authState: 'checking',
        authError: '',
        examId: '',
        loading: true,
        errorText: '',
        exam: null,
        summary: {
            participantCount: 0,
            inProgressCount: 0,
            avgScore: 0,
            avgAccuracy: 0,
            passRate: 0,
            avgDurationText: '00:00',
        },
        activeSessions: [],
        submissions: [],
        questionStats: [],
        terminating: false,
    },

    pollTimer: null,

    onLoad(options) {
        const opts = options || {};
        this.setData({ examId: opts.examId || '' });
        this.pendingLoad = true;
    },

    onShow() {
        auth.restore(this, () => {
            if (this.pendingLoad) {
                this.pendingLoad = false;
                this.load();
            } else if (this.data.exam && this.data.exam.status === 'active') {
                this.startPoll();
            }
        });
    },

    onHide() {
        this.stopPoll();
    },

    onUnload() {
        this.stopPoll();
    },

    onSignedIn() {
        this.pendingLoad = true;
        auth.signedIn(this, () => {
            this.pendingLoad = false;
            this.load();
        });
    },

    clearSignedOutData() {
        this.stopPoll();
        this.setData({ exam: null, activeSessions: [], submissions: [], questionStats: [] });
    },

    onPullDownRefresh() {
        this.load(true);
    },

    startPoll() {
        this.stopPoll();
        if (!this.data.exam || this.data.exam.status !== 'active') return;
        this.pollTimer = setInterval(() => {
            this.load(false, true);
        }, 10000);
    },

    stopPoll() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    load(fromPull, silent) {
        if (!this.data.examId) {
            this.setData({ loading: false, errorText: '缺少考试参数' });
            return;
        }
        if (!silent) {
            this.setData({ loading: true, errorText: '' });
        }
        service
            .fetchExamAnalytics(this.data.examId)
            .then((res) => {
                const exam = (res && res.exam) || null;
                const rawSummary = (res && res.summary) || {};
                const summary = {
                    participantCount: Number(rawSummary.submissionCount || rawSummary.participantCount || 0),
                    inProgressCount: Number(rawSummary.inProgressCount || 0),
                    avgScore: Number(rawSummary.avgScore || 0),
                    avgAccuracy: Number(rawSummary.avgAccuracy || 0),
                    passRate: Number(rawSummary.passRate || 0),
                    avgDurationText: util.formatDuration(rawSummary.avgDurationSeconds || 0),
                };

                const activeSessions = ((res && res.activeSessions) || []).map((s) => {
                    return Object.assign({}, s, {
                        riskLabels: mapRiskLabels(s.riskFlags),
                    });
                });

                const submissions = ((res && res.submissions) || []).map((s) => {
                    const acc =
                        s.accuracy !== undefined && s.accuracy !== null
                            ? Number(s.accuracy)
                            : Number(s.totalQuestions) > 0
                            ? Math.round((Number(s.correctCount || 0) / Number(s.totalQuestions)) * 100)
                            : 0;
                    return Object.assign({}, s, {
                        accuracy: acc,
                        durationText: util.formatDuration(s.durationSeconds || 0),
                        dateText: util.formatDate(s.submittedAt),
                        riskLabels: mapRiskLabels(s.riskFlags),
                        cheatCount: Array.isArray(s.cheatEvents) ? s.cheatEvents.length : 0,
                    });
                });

                const questionStats = ((res && res.questionStats) || []).map((q, i) => {
                    return Object.assign({}, q, { no: i + 1 });
                });

                this.setData({
                    loading: false,
                    exam: exam,
                    summary: summary,
                    activeSessions: activeSessions,
                    submissions: submissions,
                    questionStats: questionStats,
                });

                if (exam && exam.status === 'active') {
                    this.startPoll();
                } else {
                    this.stopPoll();
                }
            })
            .catch((err) => {
                this.stopPoll();
                this.setData({
                    loading: false,
                    errorText: (err && err.message) || '无权查看或考情加载失败',
                });
            })
            .then(() => {
                if (fromPull) wx.stopPullDownRefresh();
            });
    },

    confirmTerminate() {
        if (!this.data.exam || this.data.exam.status !== 'active' || this.data.terminating) return;
        wx.showModal({
            title: '主动终结考试',
            content: '终结后所有未交卷考生将立即自动判分并退出考场，确认终结吗？',
            confirmText: '确认终结',
            confirmColor: '#DC2626',
            success: (res) => {
                if (!res.confirm) return;
                this.setData({ terminating: true });
                service
                    .terminateExam(this.data.examId)
                    .then((out) => {
                        this.setData({ terminating: false });
                        const n = Number(out && out.terminatedCount) || 0;
                        wx.showToast({
                            title: '已终结，结算 ' + n + ' 名在考考生',
                            icon: 'none',
                        });
                        this.load();
                    })
                    .catch((err) => {
                        this.setData({ terminating: false });
                        wx.showToast({ title: (err && err.message) || '终结失败', icon: 'none' });
                    });
            },
        });
    },

    openSubmissionReport(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({ url: '/pages/report/report?submissionId=' + id });
    },

    retry() {
        this.load();
    },
});
