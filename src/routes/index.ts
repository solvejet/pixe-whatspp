// src/routes/index.ts
import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import os from 'node:os';

import authRoutes from './auth.routes.js';
import customerRoutes from './customer.routes.js';
import customFieldRoutes from './custom-field.routes.js';

import { auth, checkRole } from '@/middleware/auth.middleware.js';
import { notFound } from '@/middleware/error-handler.js';
import express from 'express';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { rateLimit } from 'express-rate-limit';
import { logger } from '@/utils/logger.js';
import { Role } from '@/types/auth.js';

/**
 * Interface definitions for type safety and documentation
 */
interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  environment: string;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  uptime: number;
}

interface SystemInfoResponse {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
}

/**
 * Initialize router with strict routing and case sensitive options
 * for better performance and security
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Rate limiting configuration with enhanced security options
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count successful requests against the rate limit
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later.',
  },
  keyGenerator: (req) => {
    // Use X-Forwarded-For header if behind a proxy, fallback to IP
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown'
    );
  },
});

/**
 * Health Check Endpoint
 * Used for monitoring and load balancer checks
 * Returns detailed system health information
 */
router.get('/health', (_req: Request, res: Response<HealthCheckResponse>) => {
  try {
    const memoryUsage = process.memoryUsage();

    const healthData: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      memoryUsage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memoryUsage.external / 1024 / 1024), // MB
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      },
      uptime: process.uptime(),
    };

    // Cache the response for 1 minute
    res.set('Cache-Control', 'public, max-age=60');
    res.status(200).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
      },
      uptime: 0,
    });
  }
});

/**
 * System Information Endpoint
 * Protected endpoint for getting system information
 * Requires admin role
 */
router.get(
  '/system-info',
  auth,
  checkRole([Role.ADMIN]),
  (_req: Request, res: Response<SystemInfoResponse>) => {
    try {
      const systemInfo: SystemInfoResponse = {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
      };

      // No caching for sensitive information
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.status(200).json(systemInfo);
    } catch (error) {
      logger.error('Error retrieving system info:', error);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to retrieve system information',
        500,
      );
    }
  },
);

// API version prefix
const API_VERSION = process.env.API_VERSION || '/v1';

// Public routes (no authentication required)
router.use(`${API_VERSION}/auth`, apiLimiter, authRoutes);

router.use(`${API_VERSION}/customers`, apiLimiter, customerRoutes);

router.use(`${API_VERSION}/customers/fields`, apiLimiter, customFieldRoutes);

// Catch-all route for undefined endpoints
router.all('*', (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(ErrorCode.RESOURCE_NOT_FOUND, `Cannot ${req.method} ${req.originalUrl}`, 404));
});

// Handle 404 routes - use as middleware
router.use('*', notFound as express.RequestHandler);

export default router;
