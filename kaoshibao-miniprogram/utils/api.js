/**
 * 棱题 · PrismQ · 本地服务器 REST 客户端
 *
 * 小程序直连既有的 Express + PostgreSQL 服务，JWT 令牌随请求发送。
 * 所有业务数据都来自同一个数据库，网页端与小程序天然一致，无需同步。
 */
const config = require('./config');

const TOKEN_KEY = 'ksb_auth_token';
const USER_KEY = 'ksb_auth_user';

function normalizeBaseUrl(url) {
    let value = String(url || '').trim();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    while (value.length > 1 && value.charAt(value.length - 1) === '/') {
        value = value.slice(0, -1);
    }
    return value;
}

/**
 * 后端地址固定来自 utils/config.js，不读取本地存储，也不提供修改入口。
 * 这是私有部署的小程序，只允许连接自己的服务器；即使用户本地残留过旧地址，
 * 也会被忽略，避免被改成连接其他后端。
 */
function getBaseUrl() {
    return normalizeBaseUrl(config.DEFAULT_BASE_URL || '');
}

function getToken() {
    try {
        return wx.getStorageSync(TOKEN_KEY) || '';
    } catch (e) {
        return '';
    }
}

function getUser() {
    try {
        return wx.getStorageSync(USER_KEY) || null;
    } catch (e) {
        return null;
    }
}

function setUser(user) {
    try {
        wx.setStorageSync(USER_KEY, user || null);
    } catch (e) {
        // ignore
    }
}

function saveAuth(token, user) {
    try {
        wx.setStorageSync(TOKEN_KEY, token || '');
        wx.setStorageSync(USER_KEY, user || null);
    } catch (e) {
        // ignore
    }
}

function clearAuth() {
    try {
        wx.removeStorageSync(TOKEN_KEY);
        wx.removeStorageSync(USER_KEY);
    } catch (e) {
        // ignore
    }
}

/**
 * 统一请求。成功时直接返回响应体；失败时 reject { code, message }。
 * options.anonymous = true 时不带 Authorization（登录 / 注册 / 健康检查）。
 */
function request(method, path, data, options) {
    const opts = options || {};
    const base = getBaseUrl();
    if (!base) {
        return Promise.reject({ code: 'NO_BASE_URL', message: '服务器地址未配置，请联系维护者检查 utils/config.js' });
    }

    const header = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token && !opts.anonymous) {
        header.Authorization = 'Bearer ' + token;
    }

    const ms = opts.timeout || 15000;

    return new Promise(function (resolve, reject) {
        // 兜底超时：H5 预览沙箱下 wx.request 可能既不回调 success 也不回调 fail，
        // wx.request 自带的 timeout 也不生效。没有这个计时器，Promise 会永远 pending，
        // 页面上的登录按钮就会一直转圈。
        let settled = false;
        const timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            reject({
                code: 'TIMEOUT',
                message:
                    '请求超时（' +
                    Math.max(1, Math.round(ms / 1000)) +
                    ' 秒）：服务器无响应，请检查地址是否可访问、网络是否正常、域名是否已加入白名单',
            });
        }, ms + 2000);

        function done(fn, payload) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(payload);
        }

        try {
            wx.request({
                url: base + path,
                method: method,
                data: data || {},
                header: header,
                timeout: ms,
                success: function (res) {
                    const body = res.data;
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        done(resolve, body || {});
                        return;
                    }
                    if (res.statusCode === 401) {
                        clearAuth();
                    }
                    const message =
                        (body && (body.error || body.message)) || ('请求失败（' + res.statusCode + '）');
                    done(reject, {
                        code: 'HTTP_' + res.statusCode,
                        status: res.statusCode,
                        message: String(message),
                    });
                },
                fail: function (err) {
                    const raw = String((err && err.errMsg) || '');
                    let message = '无法连接服务器，请检查地址与网络：' + raw;
                    if (raw.indexOf('path not allowed') >= 0) {
                        message =
                            '当前是 H5 预览环境，只允许 /cloud/ 路径的请求，无法直连外部服务器。请在真机（试用小程序）或微信开发者工具中验证登录';
                    } else if (raw.indexOf('domain list') >= 0 || raw.indexOf('not in domain') >= 0) {
                        message =
                            '该域名未加入小程序 request 合法域名：请在微信公众平台配置后重试（开发者工具可勾选「不校验合法域名」临时调试）';
                    } else if (raw.indexOf('timeout') >= 0) {
                        message = '连接超时：服务器未响应，请确认该地址已部署且可从公网访问';
                    } else if (raw.indexOf('ssl') >= 0 || raw.indexOf('certificate') >= 0) {
                        message = 'HTTPS 证书校验失败：请确认证书有效、由受信任 CA 签发且未过期';
                    } else if (/^http:\/\//i.test(base)) {
                        message = '小程序真机仅支持 HTTPS，请把地址改为 https:// 开头';
                    }
                    done(reject, {
                        code: 'NETWORK_ERROR',
                        message: message,
                        raw: raw,
                    });
                },
            });
        } catch (e) {
            done(reject, {
                code: 'REQUEST_ERROR',
                message: '发起请求失败：' + ((e && e.message) || '未知错误'),
            });
        }
    });
}

function get(path, params, options) {
    return request('GET', path, params, options);
}

function post(path, body, options) {
    return request('POST', path, body, options);
}

function put(path, body, options) {
    return request('PUT', path, body, options);
}

function del(path, params, options) {
    return request('DELETE', path, params, options);
}

function testConnection() {
    return get('/api/health', {}, { anonymous: true, timeout: 8000 });
}

function bootstrapStatus() {
    return get('/api/auth/bootstrap-status', {}, { anonymous: true, timeout: 8000 });
}

module.exports = {
    getBaseUrl: getBaseUrl,
    getToken: getToken,
    getUser: getUser,
    setUser: setUser,
    saveAuth: saveAuth,
    clearAuth: clearAuth,
    request: request,
    get: get,
    post: post,
    put: put,
    del: del,
    testConnection: testConnection,
    bootstrapStatus: bootstrapStatus,
};
