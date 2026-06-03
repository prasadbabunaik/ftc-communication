import {
  Activity,
  BarChart3,
  Cable,
  FileText,
  Grid3x3,
  LayoutGrid,
  Settings,
  Shield,
  Upload,
  Users,
} from 'lucide-react';

export const MENU_SIDEBAR = [
  {
    heading: 'Main',
  },
  {
    title: 'Dashboard',
    icon: BarChart3,
    path: '/dashboard',
  },
  {
    heading: 'Grid Tracker',
  },
  {
    title: 'CONTD-4 Applications',
    icon: FileText,
    path: '/contd4',
  },
  {
    title: 'FTC Tracker',
    icon: Activity,
    path: '/ftc',
  },
  {
    title: 'Transmission',
    icon: Cable,
    path: '/transmission',
  },
  {
    title: 'Region-wise Breakup',
    icon: LayoutGrid,
    path: '/breakup/region-wise',
  },
  {
    title: 'Source-wise Breakup',
    icon: Grid3x3,
    path: '/breakup/source-wise',
  },
  {
    title: 'Bulk Import',
    icon: Upload,
    path: '/import',
  },
  {
    heading: 'Administration',
    roles: ['ADMIN', 'NLDC'],
  },
  {
    title: 'User Management',
    icon: Users,
    path: '/dashboard/users',
    roles: ['ADMIN'],
  },
  {
    title: 'Access Control',
    icon: Shield,
    path: '/dashboard/access',
    roles: ['ADMIN', 'NLDC'],
  },
  {
    title: 'Settings',
    icon: Settings,
    path: '/dashboard/settings',
  },
];
