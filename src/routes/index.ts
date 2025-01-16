// src/routes/index.ts
import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import helmet from 'helmet';
import os from 'node:os';

import authRoutes from './auth.routes.js';
import customerRoutes from './customer.routes.js';
import customFieldRoutes from './custom-field.routes.js';
import callsRoutes from './calls.routes.js';
import whatsappMediaRoutes from './whatsapp-media.routes.js';
import whatsappTemplateRoutes from './whatsapp-template.routes.js';
import whatsappWebhookRoutes from './whatsapp-webhook.routes.js';

import { auth, checkRole } from '@/middleware/auth.middleware.js';
import { notFound } from '@/middleware/error-handler.js';
import type express from 'express';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import { Role } from '@/types/auth.js';
import { env } from '@/config/env.js';

/**
 * Interface definitions for responses
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
 * Initialize router with security options
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Security headers configuration
 */
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
} as const;

// Apply security headers
router.use(helmet(helmetConfig));

/**
 * Health Check Endpoint
 */
router.get('/health', (_req: Request, res: Response<HealthCheckResponse>): void => {
  try {
    const memoryUsage = process.memoryUsage();

    const healthData: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      environment: env.NODE_ENV,
      memoryUsage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
      },
      uptime: process.uptime(),
    };

    // Cache health check response
    res.set('Cache-Control', 'public, max-age=60');
    res.status(200).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      environment: env.NODE_ENV,
      memoryUsage: { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 },
      uptime: 0,
    });
  }
});

/**
 * System Information Endpoint
 */
router.get(
  '/system-info',
  auth,
  checkRole([Role.ADMIN]),
  (_req: Request, res: Response<SystemInfoResponse>): void => {
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

// API Routes with version prefix
const API_VERSION = env.API_VERSION;

// Auth routes
router.use(`${API_VERSION}/auth`, authRoutes);

// Webhook routes
router.use(`${API_VERSION}/webhooks/whatsapp`, whatsappWebhookRoutes);
router.use(`${API_VERSION}/webhooks/calls`, callsRoutes);

// Protected routes
router.use(`${API_VERSION}/customers`, customerRoutes);
router.use(`${API_VERSION}/customers/fields`, customFieldRoutes);
router.use(`${API_VERSION}/calls`, callsRoutes);
router.use(`${API_VERSION}/whatsapp/media`, whatsappMediaRoutes);
router.use(`${API_VERSION}/whatsapp/templates`, whatsappTemplateRoutes);

// 404 Handler for undefined routes
router.all('*', (req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError(ErrorCode.RESOURCE_NOT_FOUND, `Cannot ${req.method} ${req.originalUrl}`, 404));
});

// Global 404 handler
router.use('*', notFound as express.RequestHandler);

export default router;
