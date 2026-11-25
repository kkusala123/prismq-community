const TOKEN_KEY = 'kaoshibao_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function formatHttpStatusError(status: number, actionLabel = '请求失败'): string {
  if (status === 413) {
    return '上传文件过大，超出服务器限制';
  }
  if (status === 429) {
    return '请求过于频繁，请稍后再试';
  }
  if (status === 502 || status === 503 || status === 504) {
    return '服务正在重启或网关超时，请稍后重试';
  }
  return `${actionLabel} (HTTP ${status})`;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let body = options.body;
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const errMsg =
      (data as { error?: string })?.error || formatHttpStatusError(res.status, '请求失败');
    throw new ApiError(errMsg, res.status);
  }

  return data as T;
}

export async function downloadWithAuth(url: string, fallbackName: string): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let errMsg = formatHttpStatusError(res.status, '下载失败');
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) errMsg = json.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  let filename = fallbackName;
  const utf8Match = disp.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    filename = decodeURIComponent(utf8Match[1]);
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
