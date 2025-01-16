// src/middleware/auth.middleware.ts

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Role } from '@/types/auth.js';
import type { AuthenticatedRequest, DecodedToken } from '@/types/auth.js';
import { jwtService } from '@/services/jwt.service.js';
import { Redis } from '@/config/redis.js';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ErrorCode,
} from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';

/**
 * Constants for rate limiting and token management
 */
const RATE_LIMIT_CONSTANTS = {
  DEFAULT_WINDOW: 15 * 60, // 15 minutes
  DEFAULT_MAX_ATTEMPTS: 100,
  REDIS_KEY_PREFIX: 'ratelimit:',
  TOKEN_BLACKLIST_PREFIX: 'blacklist:',
  HEADER_REMAINING: 'X-RateLimit-Remaining',
  HEADER_LIMIT: 'X-RateLimit-Limit',
  HEADER_RESET: 'X-RateLimit-Reset',
} as const;

/**
 * Type guard to validate Role array
 */
function isValidRoleArray(roles: unknown): roles is Role[] {
  if (!Array.isArray(roles)) return false;
  const validRoles = new Set(Object.values(Role));
  return roles.every((role) => validRoles.has(role as Role));
}

/**
 * Extracts and validates the JWT token from the Authorization header
 */
function extractToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new AuthenticationError('No authorization header');
  }

  const [bearer, token] = authHeader.split(' ');

  if (bearer !== 'Bearer' || !token?.trim()) {
    throw new AuthenticationError('Invalid authorization header format');
  }

  return token.trim();
}

/**
 * Checks rate limit using Redis with atomic operations
 */
async function checkRateLimit(
  identifier: string,
  limit: number,
  window: number,
): Promise<{ isAllowed: boolean; remaining: number }> {
  try {
    const key = `${RATE_LIMIT_CONSTANTS.REDIS_KEY_PREFIX}${identifier}`;
    const count = await Redis.incrementRateLimit(key, window);
    return {
      isAllowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch (error) {
    logger.error('Rate limit check failed:', error);
    logger.warn('Rate limiting disabled due to Redis error');
    return { isAllowed: true, remaining: limit };
  }
}

/**
 * Validates and transforms decoded token roles
 */
function validateDecodedRoles(decoded: DecodedToken): Role[] {
  if (!isValidRoleArray(decoded.roles)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid role format in token', 401, true, {
      details: { roles: decoded.roles },
    });
  }
  return decoded.roles;
}

/**
 * Main authentication middleware
 * Verifies JWT token and attaches user information to request
 */
export const auth: RequestHandler = (async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  return await handleAuth(authReq, res, next);
}) as RequestHandler;

/**
 * Handles the authentication process
 */
async function handleAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req.headers.authorization);

    const isBlacklisted = await Redis.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new AuthenticationError('Token has been revoked');
    }

    const decoded = await jwtService.verifyToken(token);
    const validatedRoles = validateDecodedRoles(decoded);

    req.user = {
      _id: decoded.userId,
      userId: decoded.userId,
      email: decoded.email,
      roles: validatedRoles,
      permissions: decoded.permissions,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AuthenticationError('Authentication failed'));
  }
}

/**
 * Role checking middleware factory
 * Ensures user has required roles to access the route
 */
export function checkRole(requiredRoles: Role[]): RequestHandler {
  return ((req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    return handleCheckRole(authReq, res, next, requiredRoles);
  }) as RequestHandler;
}

/**
 * Handles role checking logic
 */
function handleCheckRole(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
  requiredRoles: Role[],
): void {
  if (!req.user) {
    throw new AuthenticationError('User not authenticated');
  }

  const hasRequiredRole = requiredRoles.some(
    (role) => req.user?.roles.includes(role) ?? req.user?.roles.includes(Role.ADMIN),
  );

  if (!hasRequiredRole) {
    logger.warn('Insufficient role access attempt', {
      userId: req.user.userId,
      requiredRoles,
      userRoles: req.user.roles,
      path: req.path,
      method: req.method,
    });

    throw new AuthorizationError('Insufficient role permissions');
  }

  next();
}

/**
 * Permission checking middleware factory with hierarchy support
 */
export function checkPermission(requiredPermissions: string[]): RequestHandler {
  return ((req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    return handleCheckPermission(authReq, res, next, requiredPermissions);
  }) as RequestHandler;
}

/**
 * Handles permission checking logic
 */
function handleCheckPermission(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
  requiredPermissions: string[],
): void {
  if (!req.user) {
    throw new AuthenticationError('User not authenticated');
  }

  // Admin role bypass
  if (req.user.roles.includes(Role.ADMIN)) {
    return next();
  }

  const hasAllPermissions = requiredPermissions.every((permission) => {
    if (req.user?.permissions.includes(permission)) return true;

    const permissionRoot = permission.split(':')[0];
    return req.user?.permissions.some((p: string) => p === `${permissionRoot}:*` || p === '*');
  });

  if (!hasAllPermissions) {
    logger.warn('Insufficient permission access attempt', {
      userId: req.user.userId,
      requiredPermissions,
      userPermissions: req.user.permissions,
      path: req.path,
      method: req.method,
    });

    throw new AuthorizationError('Insufficient permissions');
  }

  next();
}

/**
 * Rate limiting middleware factory
 */
export function rateLimit(max: number, windowInSeconds: number): RequestHandler {
  return ((req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    return handleRateLimit(authReq, res, next, max, windowInSeconds);
  }) as RequestHandler;
}

/**
 * Handles rate limiting logic
 */
async function handleRateLimit(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  max: number,
  windowInSeconds: number,
): Promise<void> {
  try {
    const identifier = req.user?.userId ?? req.ip ?? 'unknown';
    const { isAllowed, remaining } = await checkRateLimit(identifier, max, windowInSeconds);

    res.setHeader(RATE_LIMIT_CONSTANTS.HEADER_LIMIT, max.toString());
    res.setHeader(RATE_LIMIT_CONSTANTS.HEADER_REMAINING, remaining.toString());
    res.setHeader(
      RATE_LIMIT_CONSTANTS.HEADER_RESET,
      Math.ceil(Date.now() / 1000 + windowInSeconds).toString(),
    );

    if (!isAllowed) {
      logger.warn('Rate limit exceeded:', { identifier, path: req.path });
      throw new AppError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Too many requests, please try again later.',
        429,
      );
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Rate limit check failed', 500));
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if token is present but doesn't require authentication
 */
export const optionalAuth: RequestHandler = ((req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  return handleOptionalAuth(authReq, res, next);
}) as RequestHandler;

/**
 * Handles optional authentication logic
 */
async function handleOptionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const token = extractToken(authHeader);
    const decoded = await jwtService.verifyToken(token);
    const validatedRoles = validateDecodedRoles(decoded);

    req.user = {
      _id: decoded.userId,
      userId: decoded.userId,
      email: decoded.email,
      roles: validatedRoles,
      permissions: decoded.permissions,
    };

    next();
  } catch (error) {
    logger.debug('Optional auth failed', { error });
    next();
  }
}
