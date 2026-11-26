// 应用入口：本地 JWT 会话缓存。登录、退出或凭证失效后必须 resetSession()。
const api = require('./utils/api');

App({
    globalData: {
        appName: '棱题 · PrismQ',
        user: api.getUser(),
    },

    ensureSession() {
        if (!this.sessionPromise) {
            this.globalData.sessionError = '';
            if (!api.getBaseUrl() || !api.getToken()) {
                this.sessionPromise = Promise.resolve(null);
            } else {
                this.sessionPromise = api
                    .get('/api/auth/me')
                    .then((res) => {
                        const user = res && res.user;
                        if (!user) return null;
                        api.setUser(user);
                        this.globalData.user = user;
                        this.globalData.sessionError = '';
                        return user;
                    })
                    .catch((err) => {
                        const code = (err && err.code) || '';
                        // 只有凭证确实失效才清除登录态。网络故障、域名未配置、
                        // 服务器临时不可用都不应让用户掉登录，否则「改地址」会
                        // 直接把账号状态一起废掉，看起来就像地址改不了。
                        if (code === 'HTTP_401' || code === 'HTTP_403') {
                            api.clearAuth();
                        }
                        this.globalData.sessionError =
                            (err && err.message) || '无法校验登录状态，请检查服务器地址与网络';
                        this.globalData.user = null;
                        return null;
                    });
            }
        }
        return this.sessionPromise;
    },

    resetSession() {
        this.sessionPromise = null;
        this.globalData.user = null;
        this.globalData.sessionError = '';
    },
});
