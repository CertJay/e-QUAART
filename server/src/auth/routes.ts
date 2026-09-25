import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { ROLE_LABELS, ROLE_PERMISSIONS } from '../rbac/permissions.js';
import { authenticate } from './middleware.js';
import { hashPassword, passwordProblems, verifyPassword } from './password.js';
import { hashToken, newRefreshToken, signAccessToken } from './tokens.js';

const REFRESH_COOKIE = 'eq_rt';
const cookieOpts = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: config.sessionAbsoluteHours * 3600 * 1000,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
});

/** Refresh/logout rely on the cookie, so require a custom header as CSRF defence. */
function requireXhr(req: Request) {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') throw new AppError(403, 'CSRF', 'Missing X-Requested-With header');
}

export async function buildMe(userId: number) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      scopes: { include: { school: true, district: true, section: { include: { gradeLevel: true } }, learningArea: true, division: true } },
    },
  });
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    position: u.position,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    permissions: ROLE_PERMISSIONS[u.role],
    mustChangePassword: u.mustChangePassword,
    privacyAcceptedAt: u.privacyAcceptedAt,
    lastLoginAt: u.lastLoginAt,
    scopes: u.scopes.map((s) => ({
      scopeType: s.scopeType,
      divisionId: s.divisionId,
      districtId: s.districtId,
      schoolId: s.schoolId,
      sectionId: s.sectionId,
      learningAreaId: s.learningAreaId,
      label:
        s.school?.name ?? s.district?.name ?? s.learningArea?.name ?? s.division?.name ??
        (s.section ? `${s.section.gradeLevel.name} – ${s.section.name}` : s.scopeType),
    })),
  };
}

async function issueSession(req: Request, res: Response, userId: number, role: string) {
  const refresh = newRefreshToken();
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + config.sessionAbsoluteHours * 3600 * 1000),
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 250),
    },
  });
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts());
  return signAccessToken({ sub: userId, sid: session.id, role: role as never });
}

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const generic = unauthorized('Invalid email or password');
    if (!user || !user.isActive) {
      await audit(req, 'LOGIN_FAILED', 'User', null, null, { email: body.email });
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'LOCKED', 'Account temporarily locked after repeated failed sign-ins. Try again later.');
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= config.maxFailedLogins ? 0 : failed,
          lockedUntil: failed >= config.maxFailedLogins ? new Date(Date.now() + config.lockoutMinutes * 60000) : null,
        },
      });
      await audit(req, 'LOGIN_FAILED', 'User', user.id);
      throw generic;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await issueSession(req, res, user.id, user.role);
    req.user = { id: user.id, email: user.email, role: user.role, fullName: user.fullName, sessionId: 0 };
    await audit(req, 'LOGIN', 'User', user.id);
    res.json({ token, user: await buildMe(user.id) });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    requireXhr(req);
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw unauthorized('No active session');
    const session = await prisma.userSession.findUnique({ where: { refreshTokenHash: hashToken(raw) }, include: { user: true } });
    const idleCutoff = new Date(Date.now() - config.sessionIdleMin * 60000);
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.lastUsedAt < idleCutoff || !session.user.isActive) {
      if (session && !session.revokedAt) await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
      throw unauthorized('Session expired; please sign in again');
    }
    // Rotate the refresh token on every use.
    const refresh = newRefreshToken();
    await prisma.userSession.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(refresh), lastUsedAt: new Date() } });
    res.cookie(REFRESH_COOKIE, refresh, cookieOpts());
    const token = signAccessToken({ sub: session.userId, sid: session.id, role: session.user.role });
    res.json({ token, user: await buildMe(session.userId) });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  ah(async (req, res) => {
    await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    await audit(req, 'LOGOUT', 'User', req.user!.id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const body = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) throw badRequest('Current password is incorrect');
    const problems = passwordProblems(body.newPassword, user.email);
    if (problems.length) throw badRequest(`Password must have: ${problems.join(', ')}`);
    if (await verifyPassword(user.passwordHash, body.newPassword)) throw badRequest('New password must differ from the current one');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
    });
    // End every other session for this account.
    await prisma.userSession.updateMany({ where: { userId: user.id, id: { not: req.user!.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, 'PASSWORD_CHANGE', 'User', user.id);
    res.json({ ok: true });
  }),
);
