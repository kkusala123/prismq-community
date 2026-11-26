import type { CheatEventItem, ExamDeviceInfo } from '../../shared/types.js';

export function inspectWebEnvironment(): ExamDeviceInfo {
  const reasons: string[] = [];
  let isEmulator = false;
  let isDebugged = false;
  let isMultiWindow = false;

  if (typeof navigator !== 'undefined') {
    if ((navigator as Navigator & { webdriver?: boolean }).webdriver) {
      isEmulator = true;
      reasons.push('检测到自动化测试/WebDriver 环境');
    }
    const ua = navigator.userAgent || '';
    if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium/i.test(ua)) {
      isEmulator = true;
      reasons.push('检测到无头/虚拟浏览器环境');
    }
    if ((navigator.hardwareConcurrency ?? 4) <= 1) {
      reasons.push('CPU 核心数异常偏低 (<=1)');
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const gl =
        (canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
          : String(gl.getParameter(gl.RENDERER) || '');
        if (/SwiftShader|llvmpipe|VMware|VirtualBox|QEMU|Parallels|BlueStacks|LDPlayer|Nox/i.test(renderer)) {
          isEmulator = true;
          reasons.push(`检测到虚拟图形渲染器：${renderer}`);
        }
      }
    } catch {
      // ignore WebGL failure
    }
  }

  if (typeof window !== 'undefined' && window.screen) {
    const availW = window.screen.availWidth || window.innerWidth;
    const availH = window.screen.availHeight || window.innerHeight;
    if (availW >= 760 && (window.innerWidth < availW * 0.68 || window.innerHeight < availH * 0.6)) {
      isMultiWindow = true;
      reasons.push('浏览器处于非全屏小窗或分屏状态');
    }
    if (window.outerWidth - window.innerWidth > 180 || window.outerHeight - window.innerHeight > 220) {
      isDebugged = true;
      reasons.push('检测到开发者工具侧栏/底栏可能已开启');
    }
  }

  return {
    platform: 'web',
    deviceLabel:
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 90)
        : 'Web Browser',
    isEmulator,
    isDebugged,
    isVirtualSpace: false,
    isMultiWindow,
    reasons,
  };
}

export interface AntiCheatMonitorOptions {
  strictAntiCheat: boolean;
  onViolation: (event: CheatEventItem) => void;
}

export function attachWebAntiCheatMonitor(opts: AntiCheatMonitorOptions): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  let lastBlurAt = 0;
  let lastWindowWarnAt = 0;
  let lastDevtoolsAt = 0;

  const emit = (type: string, detail: string) => {
    opts.onViolation({
      type,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      lastBlurAt = Date.now();
      emit('tab_switch', '切换浏览器标签页或应用进入后台');
    }
  };

  const onWindowBlur = () => {
    if (!opts.strictAntiCheat) return;
    const now = Date.now();
    // 若刚刚由 visibilitychange 触发则跳过重复计数；捕获悬浮窗/桌面其他程序抢焦
    if (now - lastBlurAt < 1800) return;
    lastBlurAt = now;
    // 稍微延迟确认文档仍失焦，避免弹窗本身导致误判
    window.setTimeout(() => {
      if (!document.hasFocus() && !document.hidden) {
        emit('window_blur', '考场窗口失去焦点（疑似开启小窗/切换其他应用）');
      }
    }, 180);
  };

  const checkWindowGeometry = () => {
    if (!opts.strictAntiCheat || !window.screen) return;
    const now = Date.now();
    const availW = window.screen.availWidth || window.innerWidth;
    const availH = window.screen.availHeight || window.innerHeight;
    if (availW >= 760 && (window.innerWidth < availW * 0.68 || window.innerHeight < availH * 0.6)) {
      if (now - lastWindowWarnAt > 5000) {
        lastWindowWarnAt = now;
        emit(
          'small_window',
          `检测到缩窗/分屏作答（窗口 ${window.innerWidth}×${window.innerHeight} / 屏幕 ${availW}×${availH}）`
        );
      }
    }
    if (window.outerWidth - window.innerWidth > 180 || window.outerHeight - window.innerHeight > 220) {
      if (now - lastDevtoolsAt > 6000) {
        lastDevtoolsAt = now;
        emit('devtools', '检测到浏览器开发者工具面板占用视口');
      }
    }
  };

  const onCopyOrContext = (e: Event) => {
    if (!opts.strictAntiCheat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', checkWindowGeometry);
  document.addEventListener('copy', onCopyOrContext);
  document.addEventListener('contextmenu', onCopyOrContext);

  const periodicCheck = window.setInterval(checkWindowGeometry, 4000);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', checkWindowGeometry);
    document.removeEventListener('copy', onCopyOrContext);
    document.removeEventListener('contextmenu', onCopyOrContext);
    window.clearInterval(periodicCheck);
  };
}
