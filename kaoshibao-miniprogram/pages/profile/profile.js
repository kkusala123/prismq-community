const auth = require('../../utils/auth');
const service = require('../../utils/service');

const EMPTY_STATS = {
    myBanksCount: 0,
    totalAnswered: 0,
    accuracy: 0,
    mistakeCount: 0,
    masteredCount: 0,
    favoriteCount: 0,
};

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        user: {},
        avatarChar: '?',
        roleLabel: '成员',
        stats: Object.assign({}, EMPTY_STATS),
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
        const user = service.getUser() || {};
        this.setData({
            user: user,
            avatarChar: this.firstChar(user.nickname || user.username),
            roleLabel: user.role === 'admin' ? '管理员' : '成员',
        });
        this.loadStats();
    },

    clearSignedOutData() {
        this.setData({ stats: Object.assign({}, EMPTY_STATS) });
    },

    firstChar(name) {
        const str = String(name || '').trim();
        if (!str) return '?';
        return str.slice(0, 1).toUpperCase();
    },

    loadStats() {
        this.setData({ loading: true });
        service
            .fetchDashboard()
            .then((data) => {
                this.setData({ loading: false, stats: data.stats || this.data.stats });
            })
            .catch((err) => {
                this.setData({ loading: false });
                wx.showToast({ title: (err && err.message) || '学习统计加载失败', icon: 'none' });
            });
    },

    goMistakes() {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
    },

    goBanks() {
        wx.switchTab({ url: '/pages/banks/banks' });
    },

    goExams() {
        wx.switchTab({ url: '/pages/exams/exams' });
    },

    handleEditNickname() {
        const currentName = this.data.user.nickname || this.data.user.username || '';
        wx.showModal({
            title: '修改昵称',
            editable: true,
            content: currentName,
            placeholderText: '请输入新的显示昵称',
            confirmText: '保存',
            success: (res) => {
                if (!res.confirm) return;
                const nextName = String(res.content || '').trim();
                if (!nextName) {
                    wx.showToast({ title: '昵称不能为空', icon: 'none' });
                    return;
                }
                service
                    .updateSettings({ nickname: nextName })
                    .then((updated) => {
                        const nextUser = auth.normalizeUser((updated && updated.user) || Object.assign({}, this.data.user, { nickname: nextName }));
                        this.setData({
                            user: nextUser,
                            avatarChar: this.firstChar(nextUser.nickname || nextUser.username),
                        });
                        wx.showToast({ title: '昵称已更新', icon: 'success' });
                    })
                    .catch((err) => {
                        wx.showToast({ title: (err && err.message) || '修改昵称失败', icon: 'none' });
                    });
            },
        });
    },

    copyWebUrl() {
        wx.setClipboardData({
            data: 'https://prismq.example.com',
            success: () => wx.showToast({ title: '已复制网页端网址', icon: 'success' }),
        });
    },

    handleLogout() {
        wx.showModal({
            title: '退出登录',
            content: '退出后需要重新登录才能继续刷题，服务器上的记录会保留。',
            confirmText: '退出',
            success: (res) => {
                if (!res.confirm) return;
                auth
                    .signOut()
                    .then(() => {
                        this.restore();
                    })
                    .catch((err) => {
                        wx.showToast({ title: (err && err.message) || '退出失败', icon: 'none' });
                    });
            },
        });
    },
});
