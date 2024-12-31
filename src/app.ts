// src/app.ts
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

import { errorHandler, notFound } from '@/middleware/error-handler.js';
import { logger } from '@/utils/logger.js';
import routes from '@/routes/index.js';
import { env } from '@/config/env.js';

/**
 * Express application wrapper with enhanced security and performance configurations
 */
class App {
  public app: Express;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  /**
   * Initialize application middleware with security and performance optimizations
   */
  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
          },
        },
        crossOriginEmbedderPolicy: true,
        crossOriginOpenerPolicy: true,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        dnsPrefetchControl: true,
        frameguard: { action: 'deny' },
        hidePoweredBy: true,
        hsts: true,
        ieNoOpen: true,
        noSniff: true,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        xssFilter: true,
      }),
    );

    // CORS configuration
    const origins = env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());
    this.app.use(
      cors({
        origin: env.NODE_ENV === 'production' ? origins : 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400, // 24 hours
      }),
    );

    // Rate limiting
    this.app.use(
      rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW,
        max: env.RATE_LIMIT_MAX_REQUESTS,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req: Request) => req.ip === '127.0.0.1',
        keyGenerator: (req: Request) => {
          return (
            req.headers['x-forwarded-for']?.toString() ||
            req.ip ||
            req.socket.remoteAddress ||
            'unknown'
          );
        },
        handler: (req: Request, res: Response) => {
          logger.warn('Rate limit exceeded:', {
            ip: req.ip,
            path: req.path,
            headers: req.headers,
          });
          res.status(429).json({
            status: 'error',
            message: 'Too many requests, please try again later.',
          });
        },
      }),
    );

    // Performance middleware
    this.app.use(compression());

    // Request parsing
    this.app.use(express.json({ limit: '10kb' }));
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: '10kb',
        parameterLimit: 10,
      }),
    );

    // Logging
    if (env.NODE_ENV !== 'test') {
      this.app.use(
        morgan('combined', {
          stream: {
            write: (message) => logger.info(message.trim()),
          },
          skip: (req: Request) => req.path === '/health',
        }),
      );
    }

    // Security Headers with proper typing
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      // Use underscore prefix for unused parameters

      // Set critical security headers
      res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME type sniffing
      res.setHeader('X-Frame-Options', 'DENY'); // Prevent clickjacking
      res.setHeader('X-XSS-Protection', '1; mode=block'); // Enable browser XSS filtering
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Control referrer info
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none'); // Restrict Adobe Flash and PDF clients
      res.setHeader('X-Download-Options', 'noopen'); // Prevent IE from executing downloads

      // Add SameSite cookie policy
      res.setHeader('Set-Cookie', ['HttpOnly; Secure; SameSite=Strict']);

      // Set permissions policy
      res.setHeader(
        'Permissions-Policy',
        'geolocation=(), camera=(), microphone=(), payment=(), usb=(), ' +
          'magnetometer=(), accelerometer=(), gyroscope=(), ' +
          'document-domain=()',
      );

      next();
    });
  }

  /**
   * Initialize application routes
   */
  private initializeRoutes(): void {
    this.app.use('/api', routes);
  }

  /**
   * Initialize error handling
   */
  private initializeErrorHandling(): void {
    // Use error handling middleware
    this.app.use('*', notFound as express.RequestHandler);
    this.app.use(errorHandler as express.ErrorRequestHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (error: Error) => {
      logger.error('Unhandled Rejection:', error);
      process.exit(1);
    });
  }
}

export const app = new App().app;
