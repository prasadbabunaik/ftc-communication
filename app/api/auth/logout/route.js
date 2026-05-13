import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clearAuthCookies } from '@/lib/auth';

export async function POST(request) {
  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }

    const response = NextResponse.json({ message: 'Logged out successfully' });
    clearAuthCookies(response);

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
