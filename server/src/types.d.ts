import type { Role } from '@prisma/client';
import type { DataScope } from './rbac/scope.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; role: Role; fullName: string; sessionId: number };
      scope?: DataScope;
    }
  }
}
export {};
