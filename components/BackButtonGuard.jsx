'use client';

// Browser back-button guard.
//
// A single "sentinel" history entry is pushed at the bottom of the app's history
// stack on load. Normal in-app navigation (dashboard → FTC → …) pushes Next.js
// entries ABOVE the sentinel, so multi-level Back still works exactly as usual.
// Only when Back would LEAVE the app does it pop to the sentinel and fire here:
//   • On the Dashboard  → ask the user to confirm logout (re-arm & stay put).
//   • Anywhere else     → send them to the Dashboard instead of exiting.
//
// The sentinel preserves Next's own history.state so the router keeps working.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function BackButtonGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const pathRef = useRef(pathname);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep the latest path readable inside the (once-registered) popstate handler.
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  useEffect(() => {
    const armSentinel = () => {
      // Preserve Next's routing state so the App Router keeps working; add our flag.
      const state = { ...(window.history.state || {}), __appGuard: true };
      window.history.pushState(state, '', window.location.href);
    };
    armSentinel();

    const onPop = () => {
      if (pathRef.current === '/dashboard') {
        // At home and trying to leave → re-arm the trap and ask to log out.
        armSentinel();
        setConfirmOpen(true);
      } else {
        // Trying to leave from elsewhere with nothing before it → go to the dashboard.
        router.push('/dashboard');
      }
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Log out of the portal?</DialogTitle>
          <DialogDescription>
            You&apos;re on the Dashboard — there&apos;s no previous page. Do you want to log out, or stay signed in?
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Stay signed in
            </Button>
            <Button variant="destructive" size="sm" onClick={() => { setConfirmOpen(false); logout(); }}>
              <LogOut className="size-3.5 mr-1.5" /> Log out
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
