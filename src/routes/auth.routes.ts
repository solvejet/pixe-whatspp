// src/routes/auth.routes.ts
import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import type { Response, RequestHandler } from 'express';
import { AuthController } from '@/controllers/auth.controller.js';
import { auth, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { authSchemas } from '@/schemas/auth.schema.js';
import type {
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
  LogoutRequest,
  AuthenticatedRequest,
} from '@/types/auth.js';

/**
 * Initialize router with security settings
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Rate limit configurations
 */
const AUTH_RATE_LIMITS = {
  LOGIN: { max: 5, window: 15 * 60 }, // 5 attempts per 15 minutes
  REGISTER: { max: 3, window: 60 * 60 }, // 3 attempts per hour
  REFRESH: { max: 10, window: 15 * 60 }, // 10 attempts per 15 minutes
} as const;

const authController = new AuthController();

/**
 * Type-safe wrapper for controller methods
 */
function controllerHandler<T extends AuthenticatedRequest>(
  fn: (req: T, res: Response) => Promise<void>,
): RequestHandler {
  return async (req, res, next) => {
    try {
      await fn(req as T, res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * @route   POST /api/auth/register
 * @desc    Register new user
 * @access  Public/Admin for admin registration
 */
router.post(
  '/register',
  rateLimit(AUTH_RATE_LIMITS.REGISTER.max, AUTH_RATE_LIMITS.REGISTER.window),
  validateRequest(authSchemas.register),
  auth,
  auditMiddleware('user.register', 'auth'),
  controllerHandler<RegisterRequest>(authController.register),
);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post(
  '/login',
  rateLimit(AUTH_RATE_LIMITS.LOGIN.max, AUTH_RATE_LIMITS.LOGIN.window),
  validateRequest(authSchemas.login),
  auditMiddleware('user.login', 'auth'),
  controllerHandler<LoginRequest>(authController.login),
);

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh access token
 * @access  Public
 */
router.post(
  '/refresh-token',
  rateLimit(AUTH_RATE_LIMITS.REFRESH.max, AUTH_RATE_LIMITS.REFRESH.window),
  validateRequest(authSchemas.refreshToken),
  auditMiddleware('user.refresh-token', 'auth'),
  controllerHandler<RefreshTokenRequest>(authController.refreshToken),
);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user and invalidate tokens
 * @access  Private
 */
router.post(
  '/logout',
  auth,
  validateRequest(authSchemas.logout),
  auditMiddleware('user.logout', 'auth'),
  controllerHandler<LogoutRequest>(authController.logout),
);

export default router;
