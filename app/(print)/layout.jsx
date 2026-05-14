'use client';

import { useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { GovLoader } from '@/components/ui/gov-loader';

// Bare layout for print pages — no sidebar, no nav, no shell chrome
export default function PrintLayout({ children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      window.location.replace('/login');
    }
  }, [user, loading]);

  if (loading || !user) {
    return (
      <GovLoader
        overlay
        size="page"
        theme="navy"
        label="Preparing document"
        sublabel="Please wait…"
      />
    );
  }

  return <>{children}</>;
}
