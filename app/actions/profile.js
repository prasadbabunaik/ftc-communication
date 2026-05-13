'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { requireServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';

async function authedUser() {
  try { return await requireServerUser(); }
  catch { return null; }
}

export async function updateProfile({ name }) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!name?.trim()) return { error: 'Name is required.' };
  await prisma.user.update({ where: { id: user.id }, data: { name: name.trim() } });
  revalidatePath('/dashboard/settings');
  return { success: true };
}

export async function changePassword({ currentPassword, newPassword, confirmPassword }) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };

  if (!currentPassword) return { error: 'Current password is required.' };
  if (!newPassword || newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters.' };
  }
  if (newPassword !== confirmPassword) {
    return { error: 'New passwords do not match.' };
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const valid = await bcrypt.compare(currentPassword, dbUser.password);
  if (!valid) return { error: 'Current password is incorrect.' };

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
  // Invalidate all other sessions so re-login is required on other devices
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  return { success: true };
}

export async function getMyProfile() {
  const user = await authedUser();
  if (!user) return null;
  return prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true, name: true, email: true, role: true,
      isActive: true, createdAt: true, updatedAt: true,
      _count: { select: { createdProjects: true, projectNotes: true } },
    },
  });
}
