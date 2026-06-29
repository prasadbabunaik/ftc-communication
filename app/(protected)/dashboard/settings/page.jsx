import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { getMyProfile } from '@/app/actions/profile';
import { SettingsPageClient } from './SettingsPageClient';

export default async function SettingsPage() {
  const user = await getServerUser();
  if (!user) redirect('/login');
  // Settings (profile + password) is administrator-only; identities for NLDC /
  // RLDC users are managed in Microsoft Entra, not the portal.
  if (user.role !== 'ADMIN') redirect('/dashboard');

  const profile = await getMyProfile();
  if (!profile) redirect('/login');

  return <SettingsPageClient profile={profile} />;
}
