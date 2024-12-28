// src/config/env.ts
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
  API_BASE_URL: z.string().default('http://localhost:4000'),

  // JWT Tokens
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

  // WhatsApp Configuration
  WHATSAPP_PHONE_NUMBER_ID: z.string({
    required_error: 'WhatsApp Phone Number ID is required',
    invalid_type_error: 'WhatsApp Phone Number ID must be a string',
  }),
  WHATSAPP_ACCESS_TOKEN: z.string({
    required_error: 'WhatsApp Access Token is required',
    invalid_type_error: 'WhatsApp Access Token must be a string',
  }),
  WHATSAPP_APP_ID: z.string({
    required_error: 'WhatsApp App ID is required',
    invalid_type_error: 'WhatsApp App ID must be a string',
  }),
  WHATSAPP_APP_SECRET: z.string({
    required_error: 'WhatsApp App Secret is required',
    invalid_type_error: 'WhatsApp App Secret must be a string',
  }),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string({
    required_error: 'WhatsApp Webhook Verify Token is required',
    invalid_type_error: 'WhatsApp Webhook Verify Token must be a string',
  }),
  WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: z.string().default('en'),
  WHATSAPP_MESSAGE_TTL: z.coerce.number().default(86400), // 24 hours in seconds
  WHATSAPP_RETRY_ATTEMPTS: z.coerce.number().default(3),
  WHATSAPP_RETRY_DELAY: z.coerce.number().default(1000), // 1 second
  WHATSAPP_UPLOAD_MAX_SIZE: z.coerce.number().default(16777216), // 16MB in bytes
  WHATSAPP_UPLOAD_ALLOWED_TYPES: z
    .string()
    .default(
      'image/jpeg,image/png,audio/aac,audio/mp4,audio/amr,audio/mpeg,video/mp4,application/pdf',
    ),
  WHATSAPP_BUSINESS_ID: z.string(),
  WHATSAPP_API_VERSION: z.string(),

  // Socket.IO Configuration
  SOCKET_PING_TIMEOUT: z.coerce.number().default(5000),
  SOCKET_PING_INTERVAL: z.coerce.number().default(10000),
  SOCKET_UPGRADE_TIMEOUT: z.coerce.number().default(5000),
  SOCKET_MAX_HTTP_BUFFER_SIZE: z.coerce.number().default(1e6), // 1MB in bytes
  SOCKET_CORS_ORIGIN: z.string().default('*'),
  SOCKET_PATH: z.string().default('/socket.io'),

  // Chat Configuration
  CHAT_MESSAGE_HISTORY_LIMIT: z.coerce.number().default(50),
  CHAT_TYPING_TIMEOUT: z.coerce.number().default(5000), // 5 seconds
  CHAT_FILE_UPLOAD_MAX_SIZE: z.coerce.number().default(5242880), // 5MB in bytes
  CHAT_ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,application/pdf'),

  // Exotel Configuration
  EXOTEL_API_URL: z.string().default('https://api.exotel.com'),
  EXOTEL_ACCOUNT_SID: z.string({
    required_error: 'Exotel Account SID is required',
    invalid_type_error: 'Exotel Account SID must be a string',
  }),
  EXOTEL_API_KEY: z.string({
    required_error: 'Exotel API Key is required',
    invalid_type_error: 'Exotel API Key must be a string',
  }),
  EXOTEL_API_TOKEN: z.string({
    required_error: 'Exotel API Token is required',
    invalid_type_error: 'Exotel API Token must be a string',
  }),
  EXOTEL_CALLER_ID: z.string({
    required_error: 'Exotel Caller ID is required',
    invalid_type_error: 'Exotel Caller ID must be a string',
  }),
  EXOTEL_RECORD_CALLS: z.coerce.boolean().default(true),
  EXOTEL_RECORDING_FORMAT: z.enum(['mp3', 'mp3-hq']).default('mp3'),
  EXOTEL_RECORDING_CHANNELS: z.enum(['single', 'dual']).default('single'),
  EXOTEL_CALL_TIMEOUT: z.coerce.number().default(45), // 45 seconds
  EXOTEL_MAX_CALL_DURATION: z.coerce.number().default(3600), // 1 hour
});

// Export the type for use in other files
export type Env = z.infer<typeof envSchema>;

// Parse and validate environment variables
export const env = envSchema.parse(process.env) as Env;

// Export commonly used derived values
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

// Parse allowed file types into array for easy checking
export const allowedFileTypes = env.CHAT_ALLOWED_FILE_TYPES.split(',');
export const allowedWhatsAppFileTypes = env.WHATSAPP_UPLOAD_ALLOWED_TYPES.split(',');

// Validate required environment variables in production
if (isProduction) {
  const requiredEnvVars = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MONGODB_URI',
    'REDIS_URL',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_APP_ID',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'WHATSAPP_API_VERSION',
    'WHATSAPP_BUSINESS_ID',
    'EXOTEL_ACCOUNT_SID',
    'EXOTEL_API_KEY',
    'EXOTEL_API_TOKEN',
    'EXOTEL_CALLER_ID',
  ];

  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables in production: ${missingEnvVars.join(', ')}`,
    );
  }
}
