'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSettings } from '@/providers/settings-provider';
import { SidebarHeader } from './sidebar-header';
import { SidebarMenu } from './sidebar-menu';

export function Sidebar() {
  const { settings } = useSettings();
  const pathname = usePathname();

  return (
    <div
      className={cn(
        // z-50: the sidebar must sit ABOVE the fixed header (z-40) so that when a
        // collapsed sidebar expands on hover (80px → 280px) it cleanly overlaps
        // the header's left instead of the header painting over it. Modals/
        // popovers (z-50, portaled to <body> after this) still cover the sidebar.
        'sidebar bg-blue-50 lg:border-e lg:border-blue-100 lg:fixed lg:top-0 lg:bottom-0 lg:z-50 lg:flex flex-col items-stretch shrink-0',
        settings.layouts.demo1.sidebarTheme === 'dark' && 'dark',
      )}
    >
      <SidebarHeader />
      <div className="overflow-hidden">
        <div className="w-(--sidebar-default-width)">
          <SidebarMenu />
        </div>
      </div>
    </div>
  );
}
