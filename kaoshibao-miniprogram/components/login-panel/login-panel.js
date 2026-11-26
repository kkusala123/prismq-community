// 账号密码登录组件：登录 / 注册。后端地址固定在 utils/config.js，界面不提供地址入口。
// 直连本地服务器，登录成功后触发 signedin 事件，由各页面刷新登录态。
// 注册入口受服务端 /api/auth/bootstrap-status 的 allowRegistration 控制。
const api = require('../../utils/api');
const service = require('../../utils/service');

Component({
    data: {
        mode: 'login',
        account: '',
        password: '',
        username: '',
        email: '',
        nickname: '',
        submitting: false,
        wechatLoading: false,
        wechatEnabled: false,
        error: '',
        tip: '',
        needsSetup: false,
        allowRegistration: true,
    },

    lifetimes: {
        attached() {
            // 后端地址固定在 utils/config.js，登录面板不再暴露任何地址入口
            this.checkBootstrap();
        },
    },

    methods: {
        onAccountInput(event) {
            this.setData({ account: event.detail.value, error: '' });
        },

        onPasswordInput(event) {
            this.setData({ password: event.detail.value, error: '' });
        },

        onUsernameInput(event) {
            this.setData({ username: event.detail.value, error: '' });
        },

        onEmailInput(event) {
            this.setData({ email: event.detail.value, error: '' });
        },

        onNicknameInput(event) {
            this.setData({ nickname: event.detail.value, error: '' });
        },

        switchMode(event) {
            const mode = event.currentTarget.dataset.mode;
            if (mode === 'register' && !this.data.allowRegistration) {
                this.setData({ error: '当前服务器已关闭自助注册，请联系管理员开通账号' });
                return;
            }
            this.setData({ mode: mode, error: '', tip: '' });
        },

        checkBootstrap() {
            api.bootstrapStatus()
                .then((res) => {
                    this.setData({
                        needsSetup: !!(res && res.needsSetup),
                        allowRegistration: res ? res.allowRegistration !== false : true,
                        // 服务端未配置 WECHAT_APPID/APPSECRET 时不展示必然失败的入口
                        wechatEnabled: !!(res && res.wechatLoginEnabled),
                    });
                    if (res && res.allowRegistration === false && this.data.mode === 'register') {
                        this.setData({ mode: 'login' });
                    }
                })
                .catch(() => {
                    this.setData({ needsSetup: false, allowRegistration: true, wechatEnabled: false });
                });
        },

        onWechatLogin() {
            // 与表单提交共用 submitting，避免两个请求同时改写登录态
            if (this.data.submitting || this.data.wechatLoading) return;
            if (!this.data.wechatEnabled) {
                this.setData({ error: '当前服务器尚未开通微信登录，请使用网站账号' });
                return;
            }
            this.setData({ submitting: true, wechatLoading: true, error: '', tip: '' });
            service
                .wechatLogin()
                .then(() => {
                    this.setData({ submitting: false, wechatLoading: false });
                    this.triggerEvent('signedin');
                })
                .catch((err) => {
                    this.setData({
                        submitting: false,
                        wechatLoading: false,
                        error: (err && err.message) || '微信登录失败，请重试',
                    });
                });
        },

        validate() {
            if (!this.data.account && this.data.mode === 'login') return '请输入用户名或邮箱';
            if (!this.data.password) return '请输入密码';
            if (this.data.mode === 'register') {
                if (!/^[a-zA-Z0-9_-]{3,32}$/.test(this.data.username.trim())) {
                    return '用户名需为 3~32 位字母、数字、下划线或短横线';
                }
                if (this.data.email.indexOf('@') < 0) return '请输入有效的邮箱地址';
                if (this.data.password.length < 6) return '密码长度不能少于 6 位';
            }
            return '';
        },

        submit() {
            if (this.data.submitting) return;
            if (this.data.mode === 'register' && !this.data.allowRegistration) {
                this.setData({ error: '当前服务器已关闭自助注册，请联系管理员开通账号' });
                return;
            }
            const invalid = this.validate();
            if (invalid) {
                this.setData({ error: invalid });
                return;
            }

            this.setData({ submitting: true, error: '', tip: '' });
            const task =
                this.data.mode === 'register'
                    ? service.register({
                          username: this.data.username.trim(),
                          email: this.data.email.trim(),
                          password: this.data.password,
                          nickname: this.data.nickname.trim(),
                      })
                    : service.login(this.data.account.trim(), this.data.password);

            task.then(() => {
                this.setData({ submitting: false, password: '' });
                this.triggerEvent('signedin');
            }).catch((err) => {
                this.setData({ submitting: false, error: (err && err.message) || '操作失败，请重试' });
            });
        },
    },
});
