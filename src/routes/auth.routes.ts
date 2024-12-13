// src/routes/auth.routes.ts
import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import { asyncHandler } from '@/middleware/error-handler.js';
import { AuthController } from '@/controllers/auth.controller.js';
import { auth } from '@/middleware/auth.middleware.js';

const router: ExpressRouter = Router();
const authController = new AuthController();

router.post('/login', asyncHandler(authController.login));
router.post('/register', auth, asyncHandler(authController.register));
router.post('/refresh-token', asyncHandler(authController.refreshToken));
router.post('/logout', auth, asyncHandler(authController.logout));

export default router;
