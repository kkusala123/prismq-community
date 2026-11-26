const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        tab: 'mistakes',
        mistakes: [],
        favorites: [],
        list: [],
        counts: { mistakes: 0, favorites: 0 },
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
        this.setData({ isDemo: false });
        this.load();
    },

    clearSignedOutData() {
        this.setData({ mistakes: [], favorites: [], list: [], counts: { mistakes: 0, favorites: 0 }, errorText: '' });
    },

    onPullDownRefresh() {
        this.load(true);
    },

    load(fromPull) {
        this.setData({ loading: true, errorText: '' });
        service
            .fetchMistakes()
            .then((data) => {
                const decorate = (list) => {
                    return (list || []).map((q) => {
                        return Object.assign({}, q, {
                            typeLabel: util.TYPE_LABELS[q.type] || '题目',
                            wrongCount: (q.record && q.record.wrongCount) || 0,
                            consecutive: (q.record && q.record.consecutiveCorrect) || 0,
                            stemBrief: util.truncate(q.stem, 52),
                        });
                    });
                };

                const mistakes = decorate(data.mistakes);
                const favorites = decorate(data.favorites);

                this.setData({
                    mistakes: mistakes,
                    favorites: favorites,
                    counts: { mistakes: mistakes.length, favorites: favorites.length },
                    loading: false,
                });
                this.applyTab(this.data.tab);
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '错题加载失败' });
            })
            .then(() => {
                if (fromPull) wx.stopPullDownRefresh();
            });
    },

    switchTab(e) {
        this.applyTab(e.currentTarget.dataset.tab);
    },

    applyTab(tab) {
        this.setData({
            tab: tab,
            list: tab === 'mistakes' ? this.data.mistakes : this.data.favorites,
        });
    },

    retry(e) {
        const mode = e.currentTarget.dataset.mode;
        wx.navigateTo({ url: '/pages/practice/practice?bankId=all&mode=' + mode });
    },

    openQuestion(e) {
        const id = e.currentTarget.dataset.id;
        const mode = this.data.tab === 'mistakes' ? 'mistakes' : 'favorites';
        wx.navigateTo({
            url: '/pages/practice/practice?bankId=all&mode=' + mode + '&startId=' + id,
        });
    },

    goBanks() {
        wx.switchTab({ url: '/pages/banks/banks' });
    },
});
