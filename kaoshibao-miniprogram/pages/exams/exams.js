const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

const TYPE_ORDER = ['single', 'multiple', 'boolean', 'fill', 'short'];

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        exams: [],
        submissions: [],
        joinCode: '',
        isDemo: false,
        showCreateModal: false,
        banks: [],
        bankNames: [],
        bankIdx: 0,
        formTitle: '',
        formExamType: 'published',
        useCustomCounts: false,
        typeAvail: { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 },
        typeCounts: { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 },
        typeTotalPicked: 0,
        loadingBankTypes: false,
        formCount: '20',
        formDuration: '45',
        formMaxSwitch: '3',
        formWindowOptions: ['不限截止时间', '2 小时内有效', '24 小时内有效', '72 小时内有效'],
        formWindowHours: [0, 2, 24, 72],
        formWindowIdx: 0,
        formBlockEmulator: true,
        formStrictAntiCheat: true,
        creating: false,
        showQrModal: false,
        qrLoading: false,
        qrData: null,
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
        this.setData({ isDemo: false });
        this.load();
    },

    clearSignedOutData() {
        this.setData({ exams: [], submissions: [], errorText: '' });
    },

    onPullDownRefresh() {
        this.load(true);
    },

    load(fromPull) {
        this.setData({ loading: true, errorText: '' });
        service
            .fetchExams()
            .then((data) => {
                const me = service.getUser();
                const exams = ((data && data.exams) || []).map((e) => {
                    const isOwner = !!(me && (e.creatorId === me.id || me.role === 'admin'));
                    return Object.assign({}, e, {
                        scoreLine: e.passScore + ' / ' + e.totalScore + ' 分',
                        durationText: e.durationMinutes + ' 分钟',
                        isOwner: isOwner,
                        avgAccuracyText:
                            e.avgAccuracy !== undefined && e.avgAccuracy !== null
                                ? Number(e.avgAccuracy).toFixed(0) + '%'
                                : '--',
                    });
                });

                const submissions = ((data && data.submissions) || []).map((s) => {
                    const acc =
                        s.accuracy !== undefined && s.accuracy !== null
                            ? Number(s.accuracy)
                            : Number(s.totalQuestions) > 0
                            ? Math.round((Number(s.correctCount || 0) / Number(s.totalQuestions)) * 100)
                            : 0;
                    return Object.assign({}, s, {
                        dateText: util.formatDate(s.submittedAt),
                        scoreText: s.score + ' 分',
                        accuracyText: acc + '%',
                        passText: s.isPassed ? '已通过' : '未通过',
                    });
                });

                this.setData({ loading: false, exams: exams, submissions: submissions });
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '考试列表加载失败' });
            })
            .then(() => {
                if (fromPull) wx.stopPullDownRefresh();
            });
    },

    onJoinInput(e) {
        this.setData({ joinCode: e.detail.value });
    },

    joinExam() {
        const code = String(this.data.joinCode || '').trim().toUpperCase();
        if (!code) {
            wx.showToast({ title: '请输入考场分享码', icon: 'none' });
            return;
        }

        wx.navigateTo({
            url: '/pages/exam-take/exam-take?shareCode=' + encodeURIComponent(code),
        });
    },

    openExam(e) {
        const id = e.currentTarget.dataset.id;
        const shareCode = e.currentTarget.dataset.code;
        wx.navigateTo({
            url: '/pages/exam-take/exam-take?examId=' + encodeURIComponent(id) + '&shareCode=' + encodeURIComponent(shareCode),
        });
    },

    openAnalytics(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({
            url: '/pages/exam-analytics/exam-analytics?examId=' + encodeURIComponent(id),
        });
    },

    confirmTerminate(e) {
        const id = e.currentTarget.dataset.id;
        const title = e.currentTarget.dataset.title || '该场考试';
        if (!id) return;
        wx.showModal({
            title: '主动终结考试',
            content: '终结《' + title + '》后，所有未交卷考生将立即被结算提交，确认吗？',
            confirmText: '确认终结',
            confirmColor: '#DC2626',
            success: (res) => {
                if (!res.confirm) return;
                service
                    .terminateExam(id)
                    .then((out) => {
                        const n = Number(out && out.terminatedCount) || 0;
                        wx.showToast({ title: '已终结并结算 ' + n + ' 人', icon: 'none' });
                        this.load();
                    })
                    .catch((err) => {
                        wx.showToast({ title: (err && err.message) || '终结失败', icon: 'none' });
                    });
            },
        });
    },

    openExamQr(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        this.setData({ showQrModal: true, qrLoading: true });
        service
            .fetchExamShareQr(id)
            .then((res) => {
                this.setData({ qrLoading: false, qrData: res || null });
            })
            .catch((err) => {
                this.setData({ qrLoading: false, showQrModal: false });
                wx.showToast({ title: (err && err.message) || '生成二维码失败', icon: 'none' });
            });
    },

    closeQrModal() {
        this.setData({ showQrModal: false });
    },

    copyExamCode() {
        const code = this.data.qrData && this.data.qrData.shareCode;
        if (!code) return;
        wx.setClipboardData({
            data: code,
            success: () => wx.showToast({ title: '已复制分享码 ' + code, icon: 'success' }),
        });
    },

    shareQrToWechat() {
        const dataUrl = this.data.qrData && this.data.qrData.qrDataUrl;
        if (!dataUrl || typeof wx.getFileSystemManager !== 'function' || !wx.env || !wx.env.USER_DATA_PATH) {
            wx.showToast({ title: '当前环境不支持导出图片', icon: 'none' });
            return;
        }
        const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
        const filePath = wx.env.USER_DATA_PATH + '/prismq_exam_' + ((this.data.qrData && this.data.qrData.examId) || 'qr') + '.png';
        wx.getFileSystemManager().writeFile({
            filePath: filePath,
            data: base64,
            encoding: 'base64',
            success: () => {
                if (typeof wx.showShareImageMenu === 'function') {
                    wx.showShareImageMenu({ path: filePath });
                } else {
                    wx.saveImageToPhotosAlbum({
                        filePath: filePath,
                        success: () => wx.showToast({ title: '已保存相册', icon: 'success' }),
                    });
                }
            },
        });
    },

    loadSelectedBankTypes(bankId) {
        if (!bankId) return;
        this.setData({ loadingBankTypes: true });
        service
            .fetchBankDetail(bankId)
            .then((res) => {
                const avail = { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 };
                ((res && res.questions) || []).forEach((q) => {
                    if (avail[q.type] !== undefined) avail[q.type] += 1;
                });
                const counts = Object.assign({}, this.data.typeCounts);
                let sum = 0;
                TYPE_ORDER.forEach((t) => {
                    counts[t] = Math.min(counts[t] || 0, avail[t]);
                    sum += counts[t];
                });
                if (sum === 0) {
                    const total = TYPE_ORDER.reduce((a, t) => a + avail[t], 0);
                    const target = Math.min(20, total);
                    const weights = { single: 0.45, boolean: 0.25, multiple: 0.2, fill: 0.08, short: 0.02 };
                    const active = TYPE_ORDER.filter((t) => avail[t] > 0);
                    const wSum = active.reduce((a, t) => a + weights[t], 0) || 1;
                    let assigned = 0;
                    active.forEach((t) => {
                        const take = Math.min(avail[t], Math.round((target * weights[t]) / wSum));
                        counts[t] = take;
                        assigned += take;
                    });
                    let rem = target - assigned;
                    while (rem > 0) {
                        let moved = false;
                        active.forEach((t) => {
                            if (rem > 0 && counts[t] < avail[t]) {
                                counts[t] += 1;
                                rem -= 1;
                                moved = true;
                            }
                        });
                        if (!moved) break;
                    }
                    sum = TYPE_ORDER.reduce((a, t) => a + counts[t], 0);
                }
                this.setData({
                    typeAvail: avail,
                    typeCounts: counts,
                    typeTotalPicked: sum,
                    loadingBankTypes: false,
                });
            })
            .catch(() => {
                this.setData({ loadingBankTypes: false });
            });
    },

    openSelfTestModal() {
        this.openCreateWithMode('mock');
    },

    openCreateModal() {
        this.openCreateWithMode('published');
    },

    openCreateWithMode(mode) {
        const isMock = mode === 'mock';
        this.setData({
            showCreateModal: true,
            formExamType: isMock ? 'mock' : 'published',
            useCustomCounts: isMock,
            formDuration: isMock ? '30' : '45',
        });
        if (this.data.banks.length === 0) {
            service.fetchBanks().then((res) => {
                const banks = (res && res.banks) || [];
                const names = banks.map((b) => b.title + '（' + (b.questionCount || 0) + '题）');
                const defaultTitle = banks[0] ? banks[0].title + (isMock ? ' · 自测卷' : ' · 测评') : '';
                this.setData({
                    banks: banks,
                    bankNames: names,
                    bankIdx: 0,
                    formTitle: this.data.formTitle || defaultTitle,
                });
                if (banks[0]) this.loadSelectedBankTypes(banks[0].id);
            }).catch(function () {});
        } else if (this.data.banks[this.data.bankIdx]) {
            const cur = this.data.banks[this.data.bankIdx];
            if (!this.data.formTitle) {
                this.setData({ formTitle: cur.title + (isMock ? ' · 自测卷' : ' · 测评') });
            }
            this.loadSelectedBankTypes(cur.id);
        }
    },

    switchCreateMode(e) {
        const mode = e.currentTarget.dataset.mode === 'mock' ? 'mock' : 'published';
        this.setData({
            formExamType: mode,
            useCustomCounts: mode === 'mock' ? true : this.data.useCustomCounts,
        });
    },

    toggleCustomCounts(e) {
        this.setData({ useCustomCounts: !!e.detail.value });
    },

    stepTypeCount(e) {
        const t = e.currentTarget.dataset.type;
        const delta = Number(e.currentTarget.dataset.delta) || 0;
        const max = (this.data.typeAvail && this.data.typeAvail[t]) || 0;
        const cur = (this.data.typeCounts && this.data.typeCounts[t]) || 0;
        const next = Math.max(0, Math.min(max, cur + delta));
        const counts = Object.assign({}, this.data.typeCounts);
        counts[t] = next;
        const sum = TYPE_ORDER.reduce((a, k) => a + (counts[k] || 0), 0);
        this.setData({ typeCounts: counts, typeTotalPicked: sum });
    },

    inputTypeCount(e) {
        const t = e.currentTarget.dataset.type;
        const max = (this.data.typeAvail && this.data.typeAvail[t]) || 0;
        const next = Math.max(0, Math.min(max, Number(e.detail.value) || 0));
        const counts = Object.assign({}, this.data.typeCounts);
        counts[t] = next;
        const sum = TYPE_ORDER.reduce((a, k) => a + (counts[k] || 0), 0);
        this.setData({ typeCounts: counts, typeTotalPicked: sum });
    },

    closeCreateModal() {
        this.setData({ showCreateModal: false });
    },

    onPickBank(e) {
        const idx = Number(e.detail.value) || 0;
        const b = this.data.banks[idx];
        const suffix = this.data.formExamType === 'mock' ? ' · 自测卷' : ' · 测评';
        this.setData({
            bankIdx: idx,
            formTitle: b ? b.title + suffix : this.data.formTitle,
        });
        if (b) this.loadSelectedBankTypes(b.id);
    },

    onPickWindow(e) {
        this.setData({ formWindowIdx: Number(e.detail.value) || 0 });
    },

    onFormInput(e) {
        const key = e.currentTarget.dataset.field;
        if (!key) return;
        const patch = {};
        patch[key] = e.detail.value;
        this.setData(patch);
    },

    onSwitchChange(e) {
        const key = e.currentTarget.dataset.field;
        if (!key) return;
        const patch = {};
        patch[key] = !!e.detail.value;
        this.setData(patch);
    },

    submitCreateExam() {
        if (this.data.creating) return;
        const bank = this.data.banks[this.data.bankIdx];
        if (!bank) {
            wx.showToast({ title: '请先选择来源题库', icon: 'none' });
            return;
        }
        const isMock = this.data.formExamType === 'mock';
        const title = String(this.data.formTitle || '').trim() || (bank.title + (isMock ? ' · 自测卷' : ' · 测评'));
        const nonZeroCounts = {};
        let customSum = 0;
        if (this.data.useCustomCounts) {
            TYPE_ORDER.forEach((t) => {
                const n = Number(this.data.typeCounts[t]) || 0;
                if (n > 0) {
                    nonZeroCounts[t] = n;
                    customSum += n;
                }
            });
            if (customSum <= 0) {
                wx.showToast({ title: '请至少选择 1 道题目', icon: 'none' });
                return;
            }
        }
        const hours = !isMock ? (this.data.formWindowHours[this.data.formWindowIdx] || 0) : 0;
        const now = Date.now();
        const payload = {
            bankId: bank.id,
            title: title,
            examType: isMock ? 'mock' : 'published',
            totalQuestions: this.data.useCustomCounts ? customSum : Math.max(1, Number(this.data.formCount) || 20),
            durationMinutes: Math.max(1, Number(this.data.formDuration) || (isMock ? 30 : 45)),
            maxTabSwitches: isMock ? 99 : Math.max(0, Number(this.data.formMaxSwitch) || 3),
            blockEmulator: isMock ? false : !!this.data.formBlockEmulator,
            strictAntiCheat: isMock ? false : !!this.data.formStrictAntiCheat,
            autoSubmitOnCheat: !isMock,
            shuffleQuestions: true,
            shuffleOptions: true,
            startsAt: hours > 0 ? new Date(now).toISOString() : null,
            endsAt: hours > 0 ? new Date(now + hours * 3600 * 1000).toISOString() : null,
        };
        if (this.data.useCustomCounts) {
            payload.counts = nonZeroCounts;
        }
        this.setData({ creating: true });
        service
            .createExam(payload)
            .then((exam) => {
                this.setData({ creating: false, showCreateModal: false });
                if (isMock && exam && exam.shareCode) {
                    wx.navigateTo({
                        url: '/pages/exam-take/exam-take?examId=' + encodeURIComponent(exam.id) + '&shareCode=' + encodeURIComponent(exam.shareCode),
                    });
                } else {
                    wx.showToast({ title: '已发起！分享码 ' + (exam && exam.shareCode ? exam.shareCode : ''), icon: 'none' });
                    this.load();
                }
            })
            .catch((err) => {
                this.setData({ creating: false });
                wx.showToast({ title: (err && err.message) || '组卷失败', icon: 'none' });
            });
    },

    noop() {},

    onShareAppMessage() {
        const qr = this.data.qrData;
        if (qr && qr.shareCode) {
            return {
                title: '【棱题 · PrismQ】邀请你参加《' + (qr.title || '在线考试') + '》',
                path: '/pages/exam-take/exam-take?shareCode=' + encodeURIComponent(qr.shareCode),
            };
        }
        return {
            title: '【棱题 · PrismQ】在线考场与智能测评',
            path: '/pages/exams/exams',
        };
    },

    openReport(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/report/report?submissionId=' + id });
    },

    retry() {
        this.load();
    },
});
