// 页面登录态：checking / signed-out / signed-in 三态统一由这里驱动。
// 登录态来自本地服务器的 JWT，由 app.js 的 ensureSession() 校验一次并缓存。
const api = require('./api');

function sanitizeDisplayText(val, fallback) {
    if (val === undefined || val === null) return fallback || '';
    const trimmed = String(val).trim();
    if (!trimmed) return fallback || '';
    const lower = trimmed.toLowerCase();
    if (lower === 'null' || lower === 'undefined') return fallback || '';
    return trimmed;
}

function normalizeUser(raw) {
    const r = raw || {};
    const safeUsername = sanitizeDisplayText(r.username, '学员');
    return {
        id: r.id || '',
        username: safeUsername,
        email: r.email || '',
        nickname: sanitizeDisplayText(r.nickname, safeUsername),
        role: r.role || 'member',
        avatarUrl: r.avatarUrl || '',
        isDisabled: !!r.isDisabled,
        lastActiveAt: r.lastActiveAt || null,
        totalActiveSeconds: Number(r.totalActiveSeconds || 0),
        settings: r.settings || { removeAfterCorrectCount: 3, autoNextOnCorrect: true },
    };
}

function clearPageData(page) {
    if (typeof page.clearSignedOutData === 'function') {
        page.clearSignedOutData();
    }
}

function restore(page, onAuthed) {
    page.setData({ authState: 'checking', authError: '' });

    return getApp()
        .ensureSession()
        .then(function (user) {
            if (!user) {
                // 把连接失败的真实原因带到登录面板，避免用户只看到
                // 一个空白登录页、误以为「地址改不了」或「被无故登出」。
                const app = getApp();
                const sessionError = (app && app.globalData && app.globalData.sessionError) || '';
                app.resetSession();
                clearPageData(page);
                page.setData({ authState: 'signed-out', authError: sessionError });
                return;
            }

            const normalized = normalizeUser(user);
            getApp().globalData.user = normalized;
            page.setData({ authState: 'signed-in', user: normalized });
            if (typeof onAuthed === 'function') onAuthed(normalized);
        })
        .catch(function (err) {
            getApp().resetSession();
            clearPageData(page);
            page.setData({
                authState: 'signed-out',
                authError: (err && err.message) || '登录状态检查失败，请重试',
            });
        });
}

function signedIn(page, onAuthed) {
    getApp().resetSession();
    return restore(page, onAuthed);
}

function signOut() {
    api.clearAuth();
    getApp().resetSession();
    return Promise.resolve();
}

module.exports = {
    restore: restore,
    signedIn: signedIn,
    signOut: signOut,
    normalizeUser: normalizeUser,
};
