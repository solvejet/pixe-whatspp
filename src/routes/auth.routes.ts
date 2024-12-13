// src/routes/auth.routes.ts
import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import { asyncHandler } from '@/middleware/error-handler.js';
import { AuthController } from '@/controllers/auth.controller.js';
import { auth } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';

const router: ExpressRouter = Router();
const authController = new AuthController();

router.post('/register', auth, asyncHandler(authController.register));
router.post('/refresh-token', asyncHandler(authController.refreshToken));
router.post('/login', auditMiddleware('user.login', 'auth'), asyncHandler(authController.login));
router.post(
  '/logout',
  auth,
  auditMiddleware('user.logout', 'auth'),
  asyncHandler(authController.logout),
);

export default router;
