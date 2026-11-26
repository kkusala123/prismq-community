const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        allBanks: [],
        banks: [],
        categories: ['全部'],
        activeCategory: '全部',
        keyword: '',
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
        this.setData({ allBanks: [], banks: [], categories: ['全部'], errorText: '' });
    },

    goShareJoin() {
        wx.navigateTo({ url: '/pages/bank-share/bank-share' });
    },

    onPullDownRefresh() {
        this.load(true);
    },

    load(fromPull) {
        this.setData({ loading: true, errorText: '' });
        service
            .fetchBanks({ scope: 'all' })
            .then((data) => {
                const list = ((data && data.banks) || []).map((b) => {
                    return Object.assign({}, b, {
                        pct: util.percent(b.practicedCount, b.questionCount),
                    });
                });
                const cats = ['全部'];
                list.forEach((b) => {
                    if (b.category && cats.indexOf(b.category) < 0) cats.push(b.category);
                });
                this.setData({ allBanks: list, categories: cats, loading: false });
                this.applyFilter();
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '题库加载失败' });
            })
            .then(() => {
                if (fromPull) wx.stopPullDownRefresh();
            });
    },

    applyFilter() {
        const category = this.data.activeCategory;
        const kw = String(this.data.keyword || '').trim().toLowerCase();
        const list = this.data.allBanks.filter((b) => {
            const catOk = category === '全部' || b.category === category;
            const kwOk =
                !kw ||
                String(b.title || '').toLowerCase().indexOf(kw) >= 0 ||
                String(b.description || '').toLowerCase().indexOf(kw) >= 0;
            return catOk && kwOk;
        });
        this.setData({ banks: list });
    },

    selectCategory(e) {
        this.setData({ activeCategory: e.currentTarget.dataset.cat });
        this.applyFilter();
    },

    onSearchInput(e) {
        this.setData({ keyword: e.detail.value });
        this.applyFilter();
    },

    clearSearch() {
        this.setData({ keyword: '' });
        this.applyFilter();
    },

    openBank(e) {
        wx.navigateTo({ url: '/pages/bank-detail/bank-detail?id=' + e.currentTarget.dataset.id });
    },

    quickPractice(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/practice/practice?bankId=' + id + '&mode=sequential' });
    },

    retry() {
        this.load();
    },
});
