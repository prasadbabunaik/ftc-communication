'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronFirst } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings } from '@/providers/settings-provider';
import { Button } from '@/components/ui/button';

export function SidebarHeader() {
  const { settings, storeOption } = useSettings();

  const handleToggleClick = () => {
    storeOption('layouts.demo1.sidebarCollapse', !settings.layouts.demo1.sidebarCollapse);
  };

  return (
    <div className="sidebar-header hidden lg:flex items-center relative justify-between px-3 lg:px-5 shrink-0">
      <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
        {/* Full logo — shown when sidebar is expanded */}
        <Image
          src="/logo-full.png"
          alt="Grid India"
          width={160}
          height={40}
          className="default-logo h-9 w-auto max-w-none object-contain"
          priority
        />
        {/* Icon-only logo — shown when sidebar is collapsed */}
        <Image
          src="/logo-icon.png"
          alt="Grid India"
          width={36}
          height={36}
          className="small-logo h-9 w-auto max-w-none object-contain"
          priority
        />
      </Link>

      <Button
        onClick={handleToggleClick}
        size="sm"
        mode="icon"
        variant="outline"
        className={cn(
          'size-7 absolute start-full top-2/4 rtl:translate-x-2/4 -translate-x-2/4 -translate-y-2/4',
          settings.layouts.demo1.sidebarCollapse ? 'ltr:rotate-180' : 'rtl:rotate-180',
        )}
      >
        <ChevronFirst className="size-4!" />
      </Button>
    </div>
  );
}
