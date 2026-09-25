import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from '../config.js';

export interface AccessClaims {
  sub: number;
  sid: number;
  role: Role;
}

export const signAccessToken = (c: AccessClaims) =>
  jwt.sign({ sid: c.sid, role: c.role }, config.jwtSecret, {
    subject: String(c.sub),
    expiresIn: `${config.accessTokenTtlMin}m`,
    issuer: 'equaart',
  });

export function verifyAccessToken(token: string): AccessClaims {
  const p = jwt.verify(token, config.jwtSecret, { issuer: 'equaart' }) as jwt.JwtPayload;
  return { sub: Number(p.sub), sid: Number(p.sid), role: p.role as Role };
}

export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
