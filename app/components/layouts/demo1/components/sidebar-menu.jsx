'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MENU_SIDEBAR } from '@/config/menu.config';
import { useAuth } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';
import { cn } from '@/lib/utils';
import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  AccordionMenuSub,
  AccordionMenuSubContent,
  AccordionMenuSubTrigger,
} from '@/components/ui/accordion-menu';
import { Badge } from '@/components/ui/badge';

export function SidebarMenu() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t } = useLanguage();
  const role = user?.role;

  const isVisible = useCallback(
    (item) => !item.roles || item.roles.includes(role),
    [role],
  );

  const visibleItems = MENU_SIDEBAR.filter(isVisible);

  const matchPath = useCallback(
    (path) => path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const classNames = {
    root: 'space-y-0.5',
    group: 'gap-px',
    label: 'uppercase text-[10px] font-semibold tracking-wider text-slate-500 px-2 pt-4 pb-1 first:pt-1',
    separator: '',
    item: 'h-8 rounded-md hover:bg-blue-100 text-slate-600 hover:text-slate-900 data-[selected=true]:text-primary data-[selected=true]:bg-primary/8 data-[selected=true]:font-semibold',
    sub: '',
    subTrigger: 'h-8 rounded-md hover:bg-blue-100 text-slate-600 hover:text-slate-900 data-[selected=true]:text-primary data-[selected=true]:bg-primary/8 data-[selected=true]:font-semibold',
    subContent: 'py-0.5',
    indicator: '',
  };

  const buildMenu = (items) =>
    items.map((item, index) => {
      if (item.heading) return buildMenuHeading(item, index);
      if (item.disabled) return buildMenuItemRootDisabled(item, index);
      return buildMenuItemRoot(item, index);
    });

  const buildMenuItemRoot = (item, index) => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `root-${index}`}>
          <AccordionMenuSubTrigger className="text-[13px]" aria-label={item.title}>
            {item.icon && <item.icon className="size-4 shrink-0" data-slot="accordion-menu-icon" aria-hidden="true" />}
            <span data-slot="accordion-menu-title" className="truncate">{t(item.title)}</span>
          </AccordionMenuSubTrigger>
          <AccordionMenuSubContent
            type="single"
            collapsible
            parentValue={item.path || `root-${index}`}
            className="ps-6"
          >
            <AccordionMenuGroup>
              {buildMenuItemChildren(item.children, 1)}
            </AccordionMenuGroup>
          </AccordionMenuSubContent>
        </AccordionMenuSub>
      );
    }
    return (
      <AccordionMenuItem key={index} value={item.path || ''} className="text-[13px]">
        <Link href={item.path || '#'} aria-label={item.title} className="flex items-center grow gap-2.5 w-full">
          {item.icon && <item.icon className="size-4 shrink-0" data-slot="accordion-menu-icon" aria-hidden="true" />}
          <span data-slot="accordion-menu-title" className="truncate">{t(item.title)}</span>
        </Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuItemRootDisabled = (item, index) => (
    <AccordionMenuItem key={index} value={`disabled-${index}`} className="text-sm font-medium">
      {item.icon && <item.icon data-slot="accordion-menu-icon" />}
      <span data-slot="accordion-menu-title">{t(item.title)}</span>
      <Badge variant="secondary" size="sm" className="ms-auto me-[-10px]">
        Soon
      </Badge>
    </AccordionMenuItem>
  );

  const buildMenuItemChildren = (items, level = 0) =>
    items.map((item, index) => buildMenuItemChild(item, index, level));

  const buildMenuItemChild = (item, index, level = 0) => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `child-${level}-${index}`}>
          <AccordionMenuSubTrigger className="text-[13px]">
            {t(item.title)}
          </AccordionMenuSubTrigger>
          <AccordionMenuSubContent
            type="single"
            collapsible
            parentValue={item.path || `child-${level}-${index}`}
            className="ps-4"
          >
            <AccordionMenuGroup>
              {buildMenuItemChildren(item.children, level + 1)}
            </AccordionMenuGroup>
          </AccordionMenuSubContent>
        </AccordionMenuSub>
      );
    }
    return (
      <AccordionMenuItem key={index} value={item.path || ''} className="text-[13px]">
        <Link href={item.path || '#'} aria-label={item.title}>{t(item.title)}</Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuHeading = (item, index) => (
    <AccordionMenuLabel key={index}>{t(item.heading)}</AccordionMenuLabel>
  );

  return (
    <div className="flex grow shrink-0 py-3 px-3 lg:max-h-[calc(100vh-5.5rem)] overflow-y-auto">
      <AccordionMenu
        selectedValue={pathname}
        matchPath={matchPath}
        type="single"
        collapsible
        classNames={classNames}
      >
        {buildMenu(visibleItems)}
      </AccordionMenu>
    </div>
  );
}
