const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

const MODE_CARDS = [
    { key: 'sequential', title: '顺序练习', desc: '按题库顺序，自动续接上次断点', icon: '序', tone: 'blue' },
    { key: 'difficulty_asc', title: '由易到难', desc: '按难度升序刷题，自动续接断点', icon: '阶', tone: 'green' },
    { key: 'difficulty_desc', title: '由难到易', desc: '先攻克难题，自动续接断点', icon: '难', tone: 'rose' },
    { key: 'random', title: '随机练习', desc: '打乱题目顺序，强化记忆', icon: '随', tone: 'green' },
    { key: 'unmastered', title: '只练未掌握', desc: '跳过已斩题，专攻薄弱环节', icon: '攻', tone: 'amber' },
    { key: 'unanswered', title: '只练未作答', desc: '跳过做过的题，专攻新题', icon: '新', tone: 'blue' },
    { key: 'recite', title: '背题模式', desc: '题目与答案解析直接呈现', icon: '背', tone: 'rose' },
    { key: 'selftest', title: '自测组卷', desc: '自选单选/判断等题量组卷', icon: '测', tone: 'amber' },
];

const TYPE_ORDER = ['single', 'multiple', 'boolean', 'fill', 'short'];

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        bankId: '',
        bank: null,
        chapters: [],
        stats: { total: 0, practiced: 0, mistake: 0, mastered: 0, favorite: 0, pct: 0 },
        modes: MODE_CARDS,
        typeList: [],
        isDemo: false,
        showQrModal: false,
        qrLoading: false,
        qrData: null,
        formattingCode: false,
        showSelfTestModal: false,
        selfAvail: { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 },
        selfCounts: { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 },
        selfTotalAvail: 0,
        selfTotalPicked: 0,
        selfDurationOpts: [15, 30, 45, 60],
        selfDuration: 30,
        selfStrategyList: [
            { key: 'random', label: '全随机' },
            { key: 'balanced', label: '难度均衡' },
            { key: 'easy_first', label: '基础巩固' },
            { key: 'hard_focus', label: '难题攻坚' },
        ],
        selfStrategy: 'random',
        selfCreating: false,
    },

    onLoad(options) {
        const id = (options && options.id) || '';
        this.setData({ bankId: id });
    },

    onShow() {
        this.restore();
    },

    restore() {
        auth.restore(this, () => this.load());
    },

    onSignedIn() {
        auth.signedIn(this, () => this.load());
    },

    clearSignedOutData() {
        this.setData({ bank: null, chapters: [], errorText: '' });
    },

    load() {
        const id = this.data.bankId;
        if (!id) {
            this.setData({ loading: false, errorText: '缺少题库参数' });
            return;
        }

        this.setData({ loading: true, errorText: '' });
        service
            .fetchBankDetail(id)
            .then((data) => {
                if (!data || !data.bank) {
                    this.setData({ loading: false, errorText: '题库不存在或无权访问' });
                    return;
                }

                const questions = data.questions || [];
                const stats = { total: questions.length, practiced: 0, mistake: 0, mastered: 0, favorite: 0 };
                const typeCount = {};

                questions.forEach((q) => {
                    const r = q.record;
                    if (r) {
                        if (Number(r.answeredCount) > 0) stats.practiced += 1;
                        if (r.inMistakeBook) stats.mistake += 1;
                        if (r.isMastered) stats.mastered += 1;
                        if (r.isFavorited) stats.favorite += 1;
                    }
                    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
                });
                stats.pct = util.percent(stats.practiced, stats.total);

                const chapters = (data.chapters || []).map((c) => {
                    const total = Number(c.questionCount) || 0;
                    let practiced = 0;
                    questions.forEach((q) => {
                        if (q.chapterId === c.id && q.record && Number(q.record.answeredCount) > 0) {
                            practiced += 1;
                        }
                    });
                    return Object.assign({}, c, {
                        practiced: practiced,
                        pct: util.percent(practiced, total),
                    });
                });

                const typeList = TYPE_ORDER.filter((t) => typeCount[t] > 0).map((t) => {
                    return { key: t, label: util.TYPE_LABELS[t], count: typeCount[t] };
                });

                const s = data.stats;
                let bankStatsText = '';
                if (s && Number(s.totalCount) > 0) {
                    const parts = ['平均难度 ' + Number(s.avgDifficulty || 0).toFixed(1)];
                    if (Number(s.ratedCount) > 0) {
                        parts.push('AI 评分 ' + Number(s.avgStarRating || 0).toFixed(1) + ' 星 · 已评 ' + s.ratedCount + ' 题');
                    }
                    bankStatsText = parts.join(' · ');
                }

                this.setData({
                    bank: data.bank,
                    chapters: chapters,
                    stats: stats,
                    bankStatsText: bankStatsText,
                    typeList: typeList,
                    selfAvail: {
                        single: typeCount.single || 0,
                        multiple: typeCount.multiple || 0,
                        boolean: typeCount.boolean || 0,
                        fill: typeCount.fill || 0,
                        short: typeCount.short || 0,
                    },
                    selfTotalAvail: questions.length,
                    loading: false,
                    isDemo: service.useLocal(),
                });
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '题库详情加载失败' });
            });
    },

    startMode(e) {
        const mode = e.currentTarget.dataset.mode;
        if (mode === 'selftest') {
            this.openSelfTestModal();
            return;
        }
        let url = '/pages/practice/practice?bankId=' + this.data.bankId;
        if (mode === 'recite') {
            url += '&mode=sequential&recite=1';
        } else if (mode === 'random') {
            url += '&mode=random&shuffle=1';
        } else if (mode === 'difficulty_asc' || mode === 'difficulty_desc') {
            url += '&mode=sequential&sortBy=' + mode;
        } else {
            url += '&mode=' + mode;
        }
        wx.navigateTo({ url: url });
    },

    openSelfTestModal() {
        const avail = this.data.selfAvail || {};
        const totalAvail = this.data.selfTotalAvail || 0;
        if (totalAvail <= 0) {
            wx.showToast({ title: '题库暂无题目，请先导入', icon: 'none' });
            return;
        }
        this.applySelfTestPreset(Math.min(20, totalAvail), avail);
        this.setData({ showSelfTestModal: true });
    },

    closeSelfTestModal() {
        this.setData({ showSelfTestModal: false });
    },

    applySelfTestPreset(target, availOverride) {
        const avail = availOverride || this.data.selfAvail || {};
        const totalAvail = TYPE_ORDER.reduce((s, t) => s + (avail[t] || 0), 0);
        const counts = { single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 };
        if (totalAvail > 0 && target > 0) {
            const clamped = Math.min(target, totalAvail);
            const weights = { single: 0.45, boolean: 0.25, multiple: 0.2, fill: 0.08, short: 0.02 };
            const active = TYPE_ORDER.filter((t) => (avail[t] || 0) > 0);
            const wSum = active.reduce((s, t) => s + weights[t], 0) || 1;
            let assigned = 0;
            active.forEach((t) => {
                const share = Math.min(avail[t] || 0, Math.round((clamped * weights[t]) / wSum));
                counts[t] = share;
                assigned += share;
            });
            let rem = clamped - assigned;
            while (rem > 0) {
                let moved = false;
                active.forEach((t) => {
                    if (rem > 0 && counts[t] < (avail[t] || 0)) {
                        counts[t] += 1;
                        rem -= 1;
                        moved = true;
                    }
                });
                if (!moved) break;
            }
        }
        const sum = TYPE_ORDER.reduce((s, t) => s + counts[t], 0);
        this.setData({ selfCounts: counts, selfTotalPicked: sum });
    },

    tapSelfPreset(e) {
        const count = Number(e.currentTarget.dataset.count) || 0;
        this.applySelfTestPreset(count);
    },

    stepSelfCount(e) {
        const t = e.currentTarget.dataset.type;
        const delta = Number(e.currentTarget.dataset.delta) || 0;
        const max = (this.data.selfAvail && this.data.selfAvail[t]) || 0;
        const cur = (this.data.selfCounts && this.data.selfCounts[t]) || 0;
        const next = Math.max(0, Math.min(max, cur + delta));
        const counts = Object.assign({}, this.data.selfCounts);
        counts[t] = next;
        const sum = TYPE_ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
        this.setData({ selfCounts: counts, selfTotalPicked: sum });
    },

    inputSelfCount(e) {
        const t = e.currentTarget.dataset.type;
        const max = (this.data.selfAvail && this.data.selfAvail[t]) || 0;
        const next = Math.max(0, Math.min(max, Number(e.detail.value) || 0));
        const counts = Object.assign({}, this.data.selfCounts);
        counts[t] = next;
        const sum = TYPE_ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
        this.setData({ selfCounts: counts, selfTotalPicked: sum });
    },

    pickSelfDuration(e) {
        this.setData({ selfDuration: Number(e.currentTarget.dataset.min) || 30 });
    },

    pickSelfStrategy(e) {
        this.setData({ selfStrategy: e.currentTarget.dataset.key || 'random' });
    },

    submitSelfTest() {
        if (this.data.selfCreating) return;
        if (this.data.selfTotalPicked <= 0) {
            wx.showToast({ title: '请至少选择 1 道题', icon: 'none' });
            return;
        }
        const nonZero = {};
        TYPE_ORDER.forEach((t) => {
            if ((this.data.selfCounts[t] || 0) > 0) nonZero[t] = this.data.selfCounts[t];
        });
        const bank = this.data.bank || {};
        this.setData({ selfCreating: true });
        service
            .createExam({
                bankId: this.data.bankId,
                title: (bank.title || '题库') + ' 自由自测卷',
                examType: 'mock',
                counts: nonZero,
                totalQuestions: this.data.selfTotalPicked,
                durationMinutes: this.data.selfDuration,
                strategy: this.data.selfStrategy,
                shuffleQuestions: true,
                shuffleOptions: true,
                strictAntiCheat: false,
                autoSubmitOnCheat: false,
                blockEmulator: false,
                maxTabSwitches: 99,
            })
            .then((res) => {
                this.setData({ selfCreating: false, showSelfTestModal: false });
                wx.navigateTo({
                    url: '/pages/exam-take/exam-take?examId=' + encodeURIComponent(res.id) + '&shareCode=' + encodeURIComponent(res.shareCode),
                });
            })
            .catch((err) => {
                this.setData({ selfCreating: false });
                wx.showToast({ title: (err && err.message) || '组卷失败', icon: 'none' });
            });
    },

    startShufflePractice() {
        wx.navigateTo({
            url: '/pages/practice/practice?bankId=' + this.data.bankId + '&mode=sequential&shuffle=1',
        });
    },

    openShareQr() {
        if (this.data.isDemo) {
            wx.showToast({ title: '本地体验模式暂不支持二维码', icon: 'none' });
            return;
        }
        this.setData({ showQrModal: true, qrLoading: true });
        service
            .fetchBankShareQr(this.data.bankId)
            .then((res) => {
                this.setData({ qrLoading: false, qrData: res || null });
            })
            .catch((err) => {
                this.setData({ qrLoading: false, showQrModal: false });
                wx.showToast({ title: (err && err.message) || '生成二维码失败', icon: 'none' });
            });
    },

    closeShareQr() {
        this.setData({ showQrModal: false });
    },

    copyShareCode() {
        const code = (this.data.qrData && this.data.qrData.shareCode) || (this.data.bank && this.data.bank.shareCode);
        if (!code) return;
        wx.setClipboardData({
            data: code,
            success: () => wx.showToast({ title: '已复制口令 ' + code, icon: 'success' }),
        });
    },

    writeQrTempFile() {
        return new Promise((resolve, reject) => {
            const dataUrl = this.data.qrData && this.data.qrData.qrDataUrl;
            if (!dataUrl || typeof wx.getFileSystemManager !== 'function' || !wx.env || !wx.env.USER_DATA_PATH) {
                reject(new Error('当前环境不支持导出二维码图片'));
                return;
            }
            const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
            const filePath = wx.env.USER_DATA_PATH + '/prismq_bank_' + (this.data.bankId || 'qr') + '.png';
            wx.getFileSystemManager().writeFile({
                filePath: filePath,
                data: base64,
                encoding: 'base64',
                success: () => resolve(filePath),
                fail: (e) => reject(e),
            });
        });
    },

    shareQrImage() {
        this.writeQrTempFile()
            .then((filePath) => {
                if (typeof wx.showShareImageMenu === 'function') {
                    wx.showShareImageMenu({ path: filePath });
                } else {
                    wx.saveImageToPhotosAlbum({
                        filePath: filePath,
                        success: () => wx.showToast({ title: '二维码已保存相册', icon: 'success' }),
                        fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
                    });
                }
            })
            .catch((err) => {
                wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
            });
    },

    saveQrAlbum() {
        this.writeQrTempFile()
            .then((filePath) => {
                wx.saveImageToPhotosAlbum({
                    filePath: filePath,
                    success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
                    fail: () => wx.showToast({ title: '保存失败，请在设置中授权相册', icon: 'none' }),
                });
            })
            .catch((err) => {
                wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
            });
    },

    formatBankCodeNow() {
        if (this.data.formattingCode || this.data.isDemo) return;
        this.setData({ formattingCode: true });
        service
            .formatBankCode(this.data.bankId)
            .then((res) => {
                this.setData({ formattingCode: false });
                const n = Number(res && res.formattedCount) || 0;
                wx.showToast({
                    title: n > 0 ? '已规范 ' + n + ' 道代码题' : '题库代码已规范',
                    icon: 'none',
                });
            })
            .catch((err) => {
                this.setData({ formattingCode: false });
                wx.showToast({ title: (err && err.message) || '仅题库创建者或管理员可操作', icon: 'none' });
            });
    },

    onShareAppMessage() {
        const bank = this.data.bank || {};
        const code = (this.data.qrData && this.data.qrData.shareCode) || bank.shareCode || '';
        const path = code
            ? '/pages/bank-share/bank-share?code=' + encodeURIComponent(code)
            : '/pages/bank-detail/bank-detail?id=' + encodeURIComponent(this.data.bankId);
        return {
            title: '【棱题 · PrismQ】邀请你一起刷《' + (bank.title || '精选练习题库') + '》',
            path: path,
        };
    },

    onShareTimeline() {
        const bank = this.data.bank || {};
        return {
            title: '【棱题 · PrismQ】' + (bank.title || '精品题库'),
            query: 'id=' + encodeURIComponent(this.data.bankId),
        };
    },

    noop() {},

    startChapter(e) {
        const chapterId = e.currentTarget.dataset.id;
        wx.navigateTo({
            url: '/pages/practice/practice?bankId=' + this.data.bankId + '&mode=sequential&chapterId=' + chapterId,
        });
    },

    startType(e) {
        const type = e.currentTarget.dataset.type;
        wx.navigateTo({
            url: '/pages/practice/practice?bankId=' + this.data.bankId + '&mode=sequential&type=' + type,
        });
    },

    startAll() {
        wx.navigateTo({ url: '/pages/practice/practice?bankId=' + this.data.bankId + '&mode=sequential' });
    },

    goMistakes() {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
    },

    retry() {
        this.load();
    },
});
