import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

// Create type for environment schema
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_VERSION: z.string().default('v1'),
  ALLOWED_ORIGINS: z.string().default('*'),

  // JWT TOkens
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Database
  MONGODB_URI: z.string().default('mongodb://localhost:27017/your-database'),
  MONGODB_POOL_SIZE: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),

  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://localhost'),
  RABBITMQ_QUEUE_PREFIX: z.string().default('app'),

  // Rate Limiting
  RATE_LIMIT_WINDOW: z.coerce.number().default(900000), // 15 minutes in ms
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Server Configuration
  MAX_WORKERS: z.coerce.number().default(0), // 0 means use all available CPUs
  SHUTDOWN_TIMEOUT: z.coerce.number().default(30000),
  HEALTH_CHECK_INTERVAL: z.coerce.number().default(30000),
  HEALTH_CHECK_TIMEOUT: z.coerce.number().default(5000),
});

// Export the type for use in other files
export type Env = z.infer<typeof envSchema>;

// Parse and validate environment variables
export const env = envSchema.parse(process.env) as Env;
