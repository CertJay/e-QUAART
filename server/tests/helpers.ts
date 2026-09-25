import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

export const app = createApp();
export const PASSWORD = 'Equaart#2026';

const tokens = new Map<string, string>();

export async function login(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  tokens.set(email, res.body.token);
  return res.body.token;
}

export function as(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1${url}`)),
    post: (url: string) => auth(request(app).post(`/api/v1${url}`)),
    put: (url: string) => auth(request(app).put(`/api/v1${url}`)),
    delete: (url: string) => auth(request(app).delete(`/api/v1${url}`)),
  };
}

export async function asUser(email: string) {
  return as(await login(email));
}

export async function currentSchoolYear() {
  return prisma.schoolYear.findFirstOrThrow({ where: { isCurrent: true }, include: { terms: true } });
}

export { prisma, request };
