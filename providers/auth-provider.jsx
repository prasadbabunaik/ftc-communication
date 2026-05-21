'use client';

import React, { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

const AuthContext = createContext(undefined);

const REFRESH_INTERVAL_MS    = 12 * 60 * 1000;
const INACTIVITY_TIMEOUT_MS  = 30 * 60 * 1000;
const INACTIVITY_EVENTS      = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const router          = useRouter();
  const intervalRef     = useRef(null);
  const inactivityRef   = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const doRefresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return true;
      }
      setUser(null);
      return false;
    } catch {
      return false;
    }
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else if (res.status === 401) {
        const ok = await doRefresh();
        if (!ok) setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [doRefresh]);

  // Define logout before any effect that uses it.
  //
  // Order matters: call /api/auth/logout BEFORE clearing user state.
  // If we set user=null first, the protected layout's useEffect hard-
  // redirects to /login immediately, which interrupts the in-flight
  // fetch — cookies + refresh-token row are never cleared, and the next
  // /api/auth/me call silently logs the user back in.
  const logout = useCallback(async () => {
    clearInterval(intervalRef.current);
    clearInterval(inactivityRef.current);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Network failure shouldn't trap the user on the page — we still
      // redirect below so they can re-enter credentials.
    }
    setUser(null);
    window.location.replace('/login');
  }, []);

  // Keep a stable ref to logout so the inactivity interval can call it
  // without being torn down every time logout identity changes
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  const login = useCallback(async (email, password, recaptchaToken) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, recaptchaToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Login failed');
    setUser(data.user);
    return data;
  }, []);

  // Proactive token refresh
  useEffect(() => {
    if (!user) {
      clearInterval(intervalRef.current);
      return;
    }
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(doRefresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [user, doRefresh]);

  // Inactivity logout — checks every 60s, forces logout after 30 min idle
  useEffect(() => {
    if (!user) {
      clearInterval(inactivityRef.current);
      return;
    }
    const bump = () => { lastActivityRef.current = Date.now(); };
    INACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    clearInterval(inactivityRef.current);
    inactivityRef.current = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
        logoutRef.current();
      }
    }, 60_000);
    return () => {
      INACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(inactivityRef.current);
    };
  }, [user]); // stable: logoutRef never changes identity

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, fetchUser, lastActivityRef }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
