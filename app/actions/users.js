'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { requireServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';

async function requireAdmin() {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }
  if (user.role !== 'ADMIN') return { error: 'Access denied. Administrator role required.' };
  return { user };
}

export async function listUsers() {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true,
      isActive: true, createdAt: true, updatedAt: true,
      _count: { select: { createdProjects: true, projectNotes: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return { users };
}

export async function createUser({ name, email, password, role }) {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  if (!name?.trim()) return { error: 'Name is required.' };
  if (!email?.trim()) return { error: 'Email is required.' };
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { error: 'A user with this email already exists.' };

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { name: name.trim(), email: email.toLowerCase().trim(), password: hashedPassword, role },
  });

  revalidatePath('/dashboard/users');
  return { success: true };
}

export async function updateUser(userId, { name, email, role }) {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  if (!name?.trim()) return { error: 'Name is required.' };
  if (!email?.trim()) return { error: 'Email is required.' };

  const conflict = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), NOT: { id: userId } },
  });
  if (conflict) return { error: 'This email is already used by another account.' };

  await prisma.user.update({
    where: { id: userId },
    data: { name: name.trim(), email: email.toLowerCase().trim(), role },
  });

  revalidatePath('/dashboard/users');
  return { success: true };
}

export async function toggleUserActive(userId) {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };
  if (check.user?.id === userId) return { error: 'You cannot deactivate your own account.' };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: 'User not found.' };

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: !target.isActive },
  });

  // Invalidate active sessions when deactivating
  if (target.isActive) {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  revalidatePath('/dashboard/users');
  return { success: true, nowActive: !target.isActive };
}

export async function resetUserPassword(userId, newPassword) {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };

  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  // Force re-login on all devices
  await prisma.refreshToken.deleteMany({ where: { userId } });

  return { success: true };
}

export async function deleteUser(userId) {
  const check = await requireAdmin();
  if (check.error) return { error: check.error };
  if (check.user?.id === userId) return { error: 'You cannot delete your own account.' };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: 'User not found.' };

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath('/dashboard/users');
  return { success: true };
}
