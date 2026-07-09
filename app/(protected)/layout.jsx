'use client';

import { useEffect } from 'react';
import { Demo1Layout } from '@/app/components/layouts/demo1/layout';
import { useAuth } from '@/providers/auth-provider';
import { GovLoader } from '@/components/ui/gov-loader';
import { BackButtonGuard } from '@/components/BackButtonGuard';
import { ViewAsBar } from '@/components/ViewAsBar';

export default function ProtectedLayout({ children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      window.location.replace('/login');
    }
  }, [user, loading]);

  // Show full-page loader while auth state is resolving or redirecting
  if (loading || !user) {
    return (
      <GovLoader
        overlay
        size="page"
        theme="navy"
        label="Loading the portal"
        sublabel="Please wait…"
      />
    );
  }

  return (
    <>
      <BackButtonGuard />
      <ViewAsBar />
      <Demo1Layout>{children}</Demo1Layout>
    </>
  );
}
