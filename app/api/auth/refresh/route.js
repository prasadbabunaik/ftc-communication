import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signAccessToken, signRefreshToken, verifyRefreshToken, setAuthCookies } from '@/lib/auth';

export async function POST(request) {
  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json({ message: 'Refresh token missing' }, { status: 401 });
    }

    // Verify the token
    let payload;
    try {
      payload = await verifyRefreshToken(refreshToken);
    } catch {
      return NextResponse.json({ message: 'Invalid refresh token' }, { status: 401 });
    }

    // Check token exists in DB
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date() || !storedToken.user.isActive) {
      return NextResponse.json({ message: 'Refresh token expired or revoked' }, { status: 401 });
    }

    // Rotate: delete old, issue new pair
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const user = storedToken.user;
    const newPayload = { sub: user.id, email: user.email, role: user.role, name: user.name };

    const [newAccessToken, newRefreshToken] = await Promise.all([
      signAccessToken(newPayload),
      signRefreshToken(newPayload),
    ]);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: newAccessToken,
    });

    setAuthCookies(response, newAccessToken, newRefreshToken);

    return response;
  } catch (error) {
    console.error('Refresh error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
