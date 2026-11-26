const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        user: null,
        stats: {
            myBanksCount: 0,
            totalAnswered: 0,
            accuracy: 0,
            mistakeCount: 0,
            masteredCount: 0,
            favoriteCount: 0,
        },
        recentBanks: [],
        recentTop: null,
        recentOthers: [],
        publicBanks: [],
        activeExams: [],
        joinCode: '',
        isDemo: false,
    },

    onShow() {
        this.restore();
    },

    restore() {
        auth.restore(this, () => this.afterAuth());
    },

    onSignedIn() {
        auth.signedIn(this, () => this.afterAuth());
    },

    afterAuth() {
        this.setData({
            user: service.getUser(),
            isDemo: false,
        });
        this.loadData();
    },

    clearSignedOutData() {
        this.setData({
            recentBanks: [],
            recentTop: null,
            recentOthers: [],
            publicBanks: [],
            activeExams: [],
            errorText: '',
        });
    },

    onPullDownRefresh() {
        this.loadData(true);
    },

    loadData(fromPull) {
        this.setData({ loading: true, errorText: '' });

        service
            .fetchDashboard()
            .then((data) => {
                const recent = (data.recentBanks || []).map((b) => {
                    return Object.assign({}, b, {
                        pct: util.percent(b.practicedCount, b.questionCount),
                        nextIndex: Number(b.lastQuestionIndex || 0) + 1,
                    });
                });

                this.setData({
                    stats: data.stats || this.data.stats,
                    recentBanks: recent,
                    recentTop: recent[0] || null,
                    recentOthers: recent.slice(1),
                    publicBanks: (data.publicBanks || []).slice(0, 3),
                    activeExams: data.activeExams || [],
                    loading: false,
                });
            })
            .catch((err) => {
                this.setData({
                    loading: false,
                    errorText: (err && err.message) || '学习概览加载失败',
                });
            })
            .then(() => {
                if (fromPull) wx.stopPullDownRefresh();
            });
    },

    goBanks() {
        wx.switchTab({ url: '/pages/banks/banks' });
    },

    goMistakes() {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
    },

    goExams() {
        wx.switchTab({ url: '/pages/exams/exams' });
    },

    openBank(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/bank-detail/bank-detail?id=' + id });
    },

    startPractice(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/practice/practice?bankId=' + id + '&mode=sequential' });
    },

    startRecite(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/practice/practice?bankId=' + id + '&mode=sequential&recite=1' });
    },

    onJoinInput(e) {
        this.setData({ joinCode: e.detail.value });
    },

    joinExam() {
        const code = String(this.data.joinCode || '').trim().toUpperCase();
        if (!code) {
            wx.showToast({ title: '请输入 8 位考场分享码', icon: 'none' });
            return;
        }

        wx.showLoading({ title: '查找考场' });
        service
            .fetchExams()
            .then((data) => {
                wx.hideLoading();
                const list = (data && data.exams) || [];
                const hit = list.filter(function (e) {
                    return String(e.shareCode || '').toUpperCase() === code;
                })[0];

                if (hit) {
                    wx.navigateTo({
                        url: '/pages/exam-take/exam-take?examId=' + hit.id + '&shareCode=' + hit.shareCode,
                    });
                    return;
                }
                wx.navigateTo({
                    url: '/pages/exam-take/exam-take?shareCode=' + encodeURIComponent(code),
                });
            })
            .catch((err) => {
                wx.hideLoading();
                wx.showToast({ title: (err && err.message) || '查找失败', icon: 'none' });
            });
    },

    retry() {
        this.loadData();
    },
});
