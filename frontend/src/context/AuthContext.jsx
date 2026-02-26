import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

const AuthContext = createContext(null);

export function AuthProvider({ children, apiBase }) {
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [token, setTokenState] = useState(() => localStorage.getItem(TOKEN_KEY));

  const setToken = useCallback((newToken, newUser) => {
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
      setTokenState(newToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      setTokenState(null);
    }
    if (newUser !== undefined) {
      if (newUser) localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      else localStorage.removeItem(USER_KEY);
      setUser(newUser || null);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null, null);
  }, [setToken]);

  /** 安全解析响应为 JSON，避免空响应或非 JSON 时报错 */
  async function safeResJson(res) {
    const text = await res.text();
    if (!text || !text.trim()) return { ok: false, message: '服务器未返回数据' };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, message: '返回数据格式错误' };
    }
  }

  const fetchWithAuth = useCallback((url, options = {}) => {
    const t = localStorage.getItem(TOKEN_KEY);
    const headers = { ...options.headers };
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(url, { ...options, headers });
  }, []);

  const value = {
    user,
    token,
    isLoggedIn: !!token,
    setToken,
    logout,
    apiBase: apiBase || '/api',
    fetchWithAuth,
    safeResJson,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
