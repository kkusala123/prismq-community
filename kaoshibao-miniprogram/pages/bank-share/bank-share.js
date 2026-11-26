const auth = require('../../utils/auth');
const service = require('../../utils/service');

// 对应网页端 /banks/share/:code：私密题库分享码查询与加入
Page({
    data: {
        authState: 'checking',
        authError: '',
        code: '',
        password: '',
        loading: false,
        joining: false,
        preview: null,
        requiresPassword: false,
        errorText: '',
        tipText: '',
    },

    onLoad(options) {
        const opts = options || {};
        const rawCode = opts.code || (opts.scene ? decodeURIComponent(opts.scene) : '');
        const cleanCode = String(rawCode || '').trim().toUpperCase();
        if (cleanCode) {
            this.pendingAutoLookup = true;
            this.setData({ code: cleanCode });
        }
    },

    onShow() {
        auth.restore(this, () => {
            if (this.pendingAutoLookup && this.data.code) {
                this.pendingAutoLookup = false;
                this.lookup();
            }
        });
    },

    restore() {
        auth.restore(this, () => {
            if (this.pendingAutoLookup && this.data.code) {
                this.pendingAutoLookup = false;
                this.lookup();
            }
        });
    },

    onSignedIn() {
        auth.signedIn(this);
    },

    clearSignedOutData() {
        this.setData({ preview: null, errorText: '', tipText: '' });
    },

    onCodeInput(event) {
        this.setData({ code: event.detail.value, errorText: '' });
    },

    onPasswordInput(event) {
        this.setData({ password: event.detail.value, errorText: '' });
    },

    lookup() {
        const code = String(this.data.code || '').trim();
        if (!code) {
            this.setData({ errorText: '请输入题库分享码' });
            return;
        }
        this.setData({ loading: true, errorText: '', preview: null, tipText: '' });
        service
            .fetchSharedBank(code)
            .then((res) => {
                const bank = res && res.bank;
                if (!bank) {
                    this.setData({ loading: false, errorText: '未找到该分享码对应的题库' });
                    return;
                }
                this.setData({
                    loading: false,
                    preview: bank,
                    requiresPassword: !!bank.requiresPassword && !bank.alreadyAccessible,
                    tipText: bank.alreadyAccessible ? '你已有权限访问该题库，可直接打开。' : '',
                });
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '查询失败，请检查分享码' });
            });
    },

    join() {
        if (!this.data.preview) return;
        if (this.data.requiresPassword && !this.data.password) {
            this.setData({ errorText: '请输入私密访问口令' });
            return;
        }
        this.setData({ joining: true, errorText: '' });
        service
            .joinSharedBank(this.data.code, this.data.password)
            .then((res) => {
                const id = res && res.bankId;
                this.setData({ joining: false });
                if (!id) {
                    this.setData({ errorText: '加入失败，请重试' });
                    return;
                }
                wx.redirectTo({ url: '/pages/bank-detail/bank-detail?id=' + id });
            })
            .catch((err) => {
                this.setData({ joining: false, errorText: (err && err.message) || '加入失败，请重试' });
            });
    },

    openBank() {
        if (!this.data.preview) return;
        wx.redirectTo({ url: '/pages/bank-detail/bank-detail?id=' + this.data.preview.id });
    },

    goBack() {
        wx.navigateBack({ delta: 1 });
    },
});
