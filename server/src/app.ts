import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { prisma } from './db.js';
import { authenticate } from './auth/middleware.js';
import { authRouter, buildMe } from './auth/routes.js';
import { errorHandler, notFound } from './lib/errors.js';
import { ah } from './lib/http.js';
import { audit } from './lib/audit.js';
import { referenceRouter } from './modules/reference.js';
import { sectionsRouter } from './modules/sections.js';
import { learnersRouter } from './modules/learners.js';
import { assessmentsRouter } from './modules/assessments.js';
import { analyticsRouter } from './modules/analytics.js';
import { gapsRouter } from './modules/gaps.js';
import { interventionsRouter } from './modules/interventions.js';
import { reportsRouter } from './modules/reports.js';
import { usersRouter } from './modules/users.js';
import { governanceRouter } from './modules/governance.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: config.env === 'test' ? 100_000 : 600, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  // Nothing served by the API should be cached by browsers or proxies.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const api = express.Router();
  api.get('/health', ah(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  }));
  api.use('/auth', authRouter);

  api.use(authenticate);
  api.get('/me', ah(async (req, res) => res.json(await buildMe(req.user!.id))));
  api.post('/me/privacy-ack', ah(async (req, res) => {
    const u = await prisma.user.update({ where: { id: req.user!.id }, data: { privacyAcceptedAt: new Date() } });
    await audit(req, 'UPDATE', 'User', u.id, null, { privacyAcceptedAt: u.privacyAcceptedAt });
    res.json({ privacyAcceptedAt: u.privacyAcceptedAt });
  }));
  api.use('/reference', referenceRouter);
  api.use('/sections', sectionsRouter);
  api.use('/learners', learnersRouter);
  api.use('/assessments', assessmentsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/gaps', gapsRouter);
  api.use('/interventions', interventionsRouter);
  api.use('/reports', reportsRouter);
  api.use('/users', usersRouter);
  api.use('/governance', governanceRouter);
  api.use((_req, _res, next) => next(notFound('Endpoint')));

  app.use('/api/v1', api);

  // After `npm run build`, serve the web client from the same process and port, so a single
  // `npm start` is enough on a laptop or small school server (no nginx needed).
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
