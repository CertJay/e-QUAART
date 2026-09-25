import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const jwtSecret = required('JWT_SECRET', process.env.NODE_ENV === 'test' ? 'test-secret-test-secret-test-secret-00' : undefined);
if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  jwtSecret,
  accessTokenTtlMin: Number(process.env.ACCESS_TOKEN_TTL_MIN ?? 15),
  sessionIdleMin: Number(process.env.SESSION_IDLE_MIN ?? 30),
  sessionAbsoluteHours: Number(process.env.SESSION_ABSOLUTE_HOURS ?? 8),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  maxFailedLogins: 5,
  lockoutMinutes: 15,
};
