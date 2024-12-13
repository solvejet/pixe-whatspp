// src/middleware/auth.middleware.ts
import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from './error-handler.js';
import type { AuthenticatedRequest, ITokenPayload } from '../types/auth.js';
import { Redis } from '../config/redis.js';

export const auth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new ApiError(401, 'Authentication required');
    }

    // Check if token is blacklisted
    const isBlacklisted = await Redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new ApiError(401, 'Token has been revoked');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as ITokenPayload;

    req.user = decoded;
    next();
  } catch {
    next(new ApiError(401, 'Invalid token'));
  }
};

export const checkPermission = (requiredPermission: string) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const userPermissions = req.user?.permissions || [];

    if (
      !userPermissions.includes(requiredPermission) &&
      !userPermissions.includes('admin:manage')
    ) {
      throw new ApiError(403, 'Permission denied');
    }

    next();
  };
};

export const checkRole = (requiredRoles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles || [];

    const hasRequiredRole = requiredRoles.some(
      (role) => userRoles.includes(role) || userRoles.includes('admin'),
    );

    if (!hasRequiredRole) {
      throw new ApiError(403, 'Insufficient role');
    }

    next();
  };
};
