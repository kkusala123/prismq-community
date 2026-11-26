const auth = require('../../utils/auth');

Page({
    data: {
        authState: 'checking',
        authError: '',
        user: {},
    },

    onShow() {
        this.restore();
    },

    restore() {
        auth.restore(this);
    },

    onSignedIn() {
        auth.signedIn(this);
    },

    goHome() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
