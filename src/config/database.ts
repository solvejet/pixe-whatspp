import mongoose from 'mongoose';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';

export const connectDB = async (): Promise<typeof mongoose> => {
  try {
    const options = {
      autoIndex: true,
      maxPoolSize: env.MONGODB_POOL_SIZE,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      retryWrites: true,
      retryReads: true,
      connectTimeoutMS: 10000,
      maxConnecting: 2,
    };

    // Improved connection handling
    mongoose.connection.on('connecting', () => {
      logger.info('Connecting to MongoDB...');
    });

    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    // Handle application termination
    const terminateServer = async (): Promise<never> => {
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        logger.error('Error closing MongoDB connection:', err);
        process.exit(1);
      }
    };

    // Graceful shutdown handlers
    process.on('SIGINT', terminateServer);
    process.on('SIGTERM', terminateServer);
    process.on('SIGUSR2', terminateServer); // Nodemon restart

    await mongoose.connect(env.MONGODB_URI, options);
    return mongoose;
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};
