// src/app.ts
import express, { type Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { errorHandler } from '@/middleware/error-handler.js';
import routes from '@/routes/index.js';

const app: Express = express();

// Security middlewares
app.use(helmet());
app.use(cors());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  }),
);

// Performance middlewares
app.use(compression());
app.use(express.json({ limit: '10kb' })); // Body limit is 10kb
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Logging
app.use(morgan('combined'));

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

export { app };
