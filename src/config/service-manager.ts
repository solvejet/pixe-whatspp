// src/config/service-manager.ts
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger.js';
import { connectDB } from './database.js';
import { RabbitMQ } from './rabbit-mq.js';
import { Redis } from './redis.js';

export class ServiceManager extends EventEmitter {
  private static instance: ServiceManager;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  public async initializeServices(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.isInitializing) {
      return new Promise((resolve, reject) => {
        this.once('initialized', resolve);
        this.once('error', reject);
      });
    }

    this.isInitializing = true;
    this.initPromise = this.initialize();

    try {
      await this.initPromise;
      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }

    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    try {
      logger.info('Initializing services...');

      // Initialize services sequentially to avoid connection conflicts
      await connectDB();
      logger.info('MongoDB connected');

      await Redis.connect();
      logger.info('Redis connected');

      await RabbitMQ.initialize();
      logger.info('RabbitMQ connected');

      logger.info('All services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  public async shutdownServices(): Promise<void> {
    try {
      logger.info('Shutting down services...');

      const shutdownPromises = [
        RabbitMQ.disconnect(),
        Redis.disconnect(),
        connectDB().then((mongoose) => mongoose.connection.close()),
      ];

      await Promise.allSettled(shutdownPromises);
      logger.info('All services shut down successfully');
    } catch (error) {
      logger.error('Error during services shutdown:', error);
      throw error;
    }
  }
}

export const serviceManager = ServiceManager.getInstance();
