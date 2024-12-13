// src/server.ts
import cluster from 'cluster';
import type { Worker } from 'cluster';
import os from 'os';
import { createServer, type Server } from 'http';
import { app } from '@/app.js';
import { logger } from '@/utils/logger.js';
import { serviceManager } from '@/config/service-manager.js';

class ServerManager {
  private readonly port: number;
  private readonly numCPUs: number;
  private server: Server | null;
  private isShuttingDown: boolean;
  private workers: Map<number, Worker>;
  private readonly shutdownTimeout: number;
  private readonly healthCheckInterval: number;

  constructor() {
    this.port = Number(process.env.PORT) || 3000;
    this.numCPUs = os.cpus().length;
    this.server = null;
    this.isShuttingDown = false;
    this.workers = new Map();
    this.shutdownTimeout = Number(process.env.SHUTDOWN_TIMEOUT) || 30000; // 30 seconds
    this.healthCheckInterval = Number(process.env.HEALTH_CHECK_INTERVAL) || 5000; // 5 seconds
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Set up global error handlers
      this.setupGlobalErrorHandlers();

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

  /**
   * Setup global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      void this.handleFatalError('Uncaught Exception', error);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason);
      void this.handleFatalError('Unhandled Rejection', reason);
    });
  }

  /**
   * Handle fatal errors
   */
  private async handleFatalError(type: string, error: unknown): Promise<never> {
    logger.error(`Fatal error (${type}):`, error);

    try {
      if (cluster.isWorker) {
        await this.gracefulWorkerShutdown();
      } else {
        await this.gracefulPrimaryShutdown('SIGTERM');
      }
    } catch (shutdownError) {
      logger.error('Error during emergency shutdown:', shutdownError);
    }

    process.exit(1);
  }

  /**
   * Start primary process
   */
  private async startPrimary(): Promise<void> {
    logger.info(`Primary ${process.pid} is running`);

    // Fork workers
    for (let i = 0; i < this.numCPUs; i++) {
      this.forkWorker();
    }

    // Setup worker monitoring
    this.setupWorkerMonitoring();

    // Handle shutdown signals
    this.setupPrimarySignalHandlers();

    // Periodic health checks
    this.startHealthChecks();
  }

  /**
   * Fork a new worker
   */
  private forkWorker(): void {
    const worker = cluster.fork();
    this.workers.set(worker.process.pid!, worker);

    worker.on('message', (message: unknown) => {
      if (message === 'ready') {
        logger.info(`Worker ${worker.process.pid} is ready`);
      }
    });
  }

  /**
   * Setup worker monitoring
   */
  private setupWorkerMonitoring(): void {
    cluster.on('exit', (worker, code, signal) => {
      const pid = worker.process.pid!;
      this.workers.delete(pid);

      logger.info(`Worker ${pid} died. Signal: ${signal}. Code: ${code}`);

      if (!this.isShuttingDown && signal !== 'SIGTERM') {
        logger.info('Starting a new worker...');
        this.forkWorker();
      }
    });
  }

  /**
   * Setup primary process signal handlers
   */
  private setupPrimarySignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        await this.gracefulPrimaryShutdown(signal);
      });
    });
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    setInterval(() => {
      this.workers.forEach((worker, pid) => {
        worker.send('health_check');
        const timeout = setTimeout(() => {
          logger.error(`Worker ${pid} health check failed. Killing worker.`);
          worker.kill();
        }, 5000);

        worker.once('message', (message: unknown) => {
          if (message === 'health_ok') {
            clearTimeout(timeout);
          }
        });
      });
    }, this.healthCheckInterval);
  }

  /**
   * Start worker process
   */
  private async startWorker(): Promise<void> {
    try {
      // Initialize services
      await serviceManager.initializeServices();

      // Create HTTP server
      this.server = createServer(app);

      // Handle server errors
      this.server.on('error', (error) => {
        logger.error('Server error:', error);
      });

      // Start listening
      this.server.listen(this.port, () => {
        logger.info(`Worker ${process.pid} is running on port ${this.port}`);
        if (process.send) {
          process.send('ready');
        }
      });

      // Handle process messages
      this.setupWorkerMessageHandlers();
    } catch (error) {
      logger.error('Worker startup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Setup worker message handlers
   */
  private setupWorkerMessageHandlers(): void {
    process.on('message', async (msg: string) => {
      switch (msg) {
        case 'shutdown':
          if (!this.isShuttingDown) {
            await this.gracefulWorkerShutdown();
          }
          break;
        case 'health_check':
          if (process.send) {
            process.send('health_ok');
          }
          break;
      }
    });
  }

  /**
   * Gracefully shutdown primary process
   */
  private async gracefulPrimaryShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown of primary process...`);

    // Notify all workers to stop accepting new connections
    const workerShutdowns = Array.from(this.workers.values()).map((worker) => {
      return new Promise<void>((resolve) => {
        worker.once('exit', () => resolve());
        worker.send('shutdown');

        // Force kill after timeout
        setTimeout(() => {
          logger.warn(`Worker ${worker.process.pid} did not shut down gracefully. Force killing.`);
          worker.kill('SIGKILL');
        }, this.shutdownTimeout);
      });
    });

    try {
      await Promise.all(workerShutdowns);
      logger.info('All workers have been shut down');
    } catch (error) {
      logger.error('Error during worker shutdown:', error);
    }

    logger.info('Primary process shutdown completed');
    process.exit(0);
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

      // Clean up services
      await serviceManager.shutdownServices();

      logger.info(`Worker ${process.pid} shutdown completed`);
      process.exit(0);
    } catch (error) {
      logger.error('Error during worker shutdown:', error);
      process.exit(1);
    }
  }
}

// Create and start the server
const server = new ServerManager();
void server.start();
