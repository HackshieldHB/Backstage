'use client';

import { create } from 'zustand';
import type { AuthResponse, MfaChallengeDto, UserDto } from '@backstages/shared';
import { api, setTokens, getAccessToken } from '@/lib/api';
import { destroySocket } from '@/lib/socket';

interface AuthState {
  user: UserDto | null;
  loading: boolean;
  bootstrap: () => Promise<void>;
  /** Resolves to an mfaToken when the account has 2FA on (finish with loginTwoFactor). */
  login: (email: string, password: string) => Promise<{ mfaToken: string } | null>;
  loginTwoFactor: (mfaToken: string, code: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: UserDto) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  bootstrap: async () => {
    if (!getAccessToken()) {
      set({ user: null, loading: false });
      return;
    }
    try {
      const user = await api<UserDto>('GET', '/auth/me');
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  login: async (email, password) => {
    const res = await api<AuthResponse | MfaChallengeDto>('POST', '/auth/login', { email, password }, { retry: false });
    if ('mfaRequired' in res) return { mfaToken: res.mfaToken };
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ user: res.user, loading: false });
    return null;
  },

  loginTwoFactor: async (mfaToken, code) => {
    const res = await api<AuthResponse>('POST', '/auth/login/2fa', { mfaToken, code }, { retry: false });
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ user: res.user, loading: false });
  },

  signup: async (email, password, displayName) => {
    const res = await api<AuthResponse>('POST', '/auth/signup', { email, password, displayName });
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    set({ user: res.user, loading: false });
  },

  logout: async () => {
    const refreshToken =
      typeof window !== 'undefined' ? window.localStorage.getItem('bs.refreshToken') : null;
    if (refreshToken) await api('POST', '/auth/logout', { refreshToken }).catch(() => undefined);
    setTokens(null);
    destroySocket();
    set({ user: null });
    window.location.href = '/login';
  },

  setUser: (user) => set({ user }),
}));
