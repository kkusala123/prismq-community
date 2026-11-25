import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../../shared/types.js';
import { apiFetch, getAuthToken, setAuthToken } from './api';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (account: string, password: string) => Promise<void>;
  register: (payload: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  canInstallPwa: boolean;
  isStandalonePwa: boolean;
  installPwa: () => Promise<'accepted' | 'dismissed' | 'ios-guide' | 'unsupported'>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalonePwa, setIsStandalonePwa] = useState(false);
  const pendingUsageSecRef = useRef(0);

  const refreshUser = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ user: PublicUser }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!user?.id) {
      pendingUsageSecRef.current = 0;
      return;
    }

    const resolveUsageMode = (pathname: string): 'practice' | 'exam' | 'general' => {
      if (pathname.startsWith('/practice')) return 'practice';
      if (pathname.startsWith('/exam/join')) return 'exam';
      return 'general';
    };

    const flushHeartbeat = (keepalive: boolean) => {
      const sec = Math.min(120, Math.round(pendingUsageSecRef.current));
      const token = getAuthToken();
      if (!token || sec <= 0) return;
      pendingUsageSecRef.current = 0;
      const pathname = window.location.pathname;
      const payload = {
        deltaSeconds: sec,
        mode: resolveUsageMode(pathname),
        path: pathname,
      };
      if (keepalive) {
        void fetch('/api/auth/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => undefined);
      } else {
        void apiFetch('/api/auth/heartbeat', {
          method: 'POST',
          json: payload,
        }).catch(() => undefined);
      }
    };

    const tickTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        pendingUsageSecRef.current += 1;
        if (pendingUsageSecRef.current >= 30) {
          flushHeartbeat(false);
        }
      }
    }, 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && pendingUsageSecRef.current >= 5) {
        flushHeartbeat(true);
      }
    };

    const onPageHide = () => {
      if (pendingUsageSecRef.current >= 5) {
        flushHeartbeat(true);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(tickTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      pendingUsageSecRef.current = 0;
    };
  }, [user?.id]);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalonePwa(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const login = async (account: string, password: string) => {
    const data = await apiFetch<{ token: string; user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      json: { account, password },
    });
    setAuthToken(data.token);
    setUser(data.user);
  };

  const register = async (payload: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }) => {
    const data = await apiFetch<{ token: string; user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      json: payload,
    });
    setAuthToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
  };

  const installPwa = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return choice.outcome;
    }
    const isIos = /iPad|iPhone|iPod/i.test(navigator.userAgent);
    if (isIos) return 'ios-guide';
    return 'unsupported';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
        canInstallPwa: Boolean(deferredPrompt),
        isStandalonePwa,
        installPwa,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
