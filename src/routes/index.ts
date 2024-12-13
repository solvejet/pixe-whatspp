// src/routes/index.ts
import type { Router as ExpressRouter, Request, Response } from 'express';
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import { notFound } from '@/middleware/error-handler.js';

// Define health check response type
type HealthCheckResponse = {
  status: 'ok' | 'error';
  timestamp?: string;
  version?: string;
};

const router: ExpressRouter = Router();

// Health check route with proper typing
router.get('/health', (_req: Request, res: Response<HealthCheckResponse>) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API version
const API_VERSION = '/v1';

// Routes
router.use(`${API_VERSION}/auth`, authRoutes);

// Handle 404
router.use(notFound);

export default router;
