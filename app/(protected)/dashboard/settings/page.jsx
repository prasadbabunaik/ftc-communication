import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { getMyProfile } from '@/app/actions/profile';
import { SettingsPageClient } from './SettingsPageClient';

export default async function SettingsPage() {
  const user = await getServerUser();
  if (!user) redirect('/login');

  const profile = await getMyProfile();
  if (!profile) redirect('/login');

  return <SettingsPageClient profile={profile} />;
}
