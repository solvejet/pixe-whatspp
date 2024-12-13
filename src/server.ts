// src/server.ts
import cluster from 'cluster';
import type { Worker } from 'cluster';
import os from 'os';
import mongoose from 'mongoose';
import { createServer, type Server } from 'http';
import { app } from '@/app.js';
import { logger } from '@/utils/logger.js';
import { connectDB } from '@/config/database.js';
import { RabbitMQ, initializeRabbitMQ } from '@/config/rabbit-mq.js';
import { Redis } from '@/config/redis.js';

class ServerManager {
  private readonly port: number;
  private readonly numCPUs: number;
  private server: Server | null;
  private isShuttingDown: boolean;

  constructor() {
    this.port = Number(process.env.PORT) || 3000;
    this.numCPUs = os.cpus().length;
    this.server = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize all required services
   */
  private async initializeServices(): Promise<void> {
    try {
      logger.info('Initializing services...');
      await Promise.all([connectDB(), Redis.connect(), initializeRabbitMQ()]);
      logger.info('All services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown all services
   */
  private async shutdownServices(): Promise<void> {
    try {
      logger.info('Shutting down services...');
      await Promise.all([mongoose.connection.close(), Redis.disconnect(), RabbitMQ.disconnect()]);
      logger.info('All services shut down successfully');
    } catch (error) {
      logger.error('Error during services shutdown:', error);
      throw error;
    }
  }

  /**
   * Handle worker process
   */
  private async startWorker(): Promise<void> {
    try {
      await this.initializeServices();

      this.server = createServer(app);

      // Handle server errors
      this.server.on('error', (error) => {
        logger.error('Server error:', error);
      });

      // Start listening
      this.server.listen(this.port, () => {
        logger.info(`Worker ${process.pid} is running on port ${this.port}`);
      });

      // Handle process messages
      process.on('message', async (msg: string) => {
        if (msg === 'shutdown' && !this.isShuttingDown) {
          await this.gracefulWorkerShutdown();
        }
      });
    } catch (error) {
      logger.error('Worker startup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Gracefully shutdown worker process
   */
  private async gracefulWorkerShutdown(): Promise<void> {
    try {
      this.isShuttingDown = true;
      logger.info(`Worker ${process.pid} is starting graceful shutdown...`);

      // Stop accepting new connections
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server?.close(() => {
            logger.info(`Worker ${process.pid} closed all connections`);
            resolve();
          });
        });
      }

      // Cleanup services
      await this.shutdownServices();

      process.exit(0);
    } catch (error) {
      logger.error('Error during worker shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Handle primary process
   */
  private async startPrimary(): Promise<void> {
    logger.info(`Primary ${process.pid} is running`);

    // Fork workers
    for (let i = 0; i < this.numCPUs; i++) {
      cluster.fork();
    }

    // Handle worker exits
    cluster.on('exit', (worker, code, signal) => {
      logger.info(`Worker ${worker.process.pid} died. Signal: ${signal}. Code: ${code}`);

      if (!this.isShuttingDown && signal !== 'SIGTERM') {
        logger.info('Starting a new worker...');
        cluster.fork();
      }
    });

    // Handle shutdown signals
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        await this.gracefulPrimaryShutdown(signal);
      });
    });
  }

  /**
   * Gracefully shutdown primary process and all workers
   */
  private async gracefulPrimaryShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`);

    // Notify all workers to stop accepting new connections
    const workers = cluster.workers;
    if (workers) {
      Object.values(workers).forEach((worker: Worker | undefined) => {
        if (worker) {
          worker.send('shutdown');
        }
      });

      // Wait for all workers to exit
      await new Promise<void>((resolve) => {
        cluster.on('exit', () => {
          const workerCount = workers ? Object.keys(workers).length : 0;
          if (workerCount === 0) {
            logger.info('All workers have exited');
            resolve();
          }
        });
      });
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Set up global error handlers
      process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        process.exit(1);
      });

      process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled Rejection:', reason);
        process.exit(1);
      });

      // Start appropriate process
      if (cluster.isPrimary) {
        await this.startPrimary();
      } else {
        await this.startWorker();
      }
    } catch (error) {
      logger.error('Server failed to start:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new ServerManager();
void server.start();
