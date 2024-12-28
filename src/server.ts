// Load environment configuration first
import { env } from '@/config/env.js';

import cluster from 'cluster';
import type { Worker } from 'cluster';
import os from 'os';
import { createServer, type Server } from 'http';
import { app } from '@/app.js';
import { logger } from '@/utils/logger.js';
import { serviceManager } from '@/config/service-manager.js';

interface SystemError extends Error {
  code?: string;
}

class ServerManager {
  private readonly port: number;
  private readonly numCPUs: number;
  private server: Server | null;
  private isShuttingDown: boolean;
  private workers: Map<number, Worker>;
  private readonly shutdownTimeout: number;
  private readonly healthCheckInterval: number;
  private readonly healthCheckTimeout: number;
  private healthCheckTimers: Map<number, NodeJS.Timeout>;
  private startupTimeout: NodeJS.Timeout | null;

  constructor() {
    // Initialize server configuration using environment variables
    this.port = env.PORT;
    const availableCPUs = os.cpus().length;

    // Handle MAX_WORKERS with proper type checking
    this.numCPUs = this.calculateWorkerCount(availableCPUs);

    // Initialize server state
    this.server = null;
    this.isShuttingDown = false;
    this.workers = new Map();
    this.healthCheckTimers = new Map();
    this.startupTimeout = null;

    // Configure timeouts from environment
    this.shutdownTimeout = env.SHUTDOWN_TIMEOUT;
    this.healthCheckInterval = env.HEALTH_CHECK_INTERVAL;
    this.healthCheckTimeout = env.HEALTH_CHECK_TIMEOUT;
  }

  /**
   * Calculate the number of worker processes to use
   */
  private calculateWorkerCount(availableCPUs: number): number {
    const maxWorkersEnv = env.MAX_WORKERS;

    // If MAX_WORKERS is not set or is 0, use available CPUs
    if (!maxWorkersEnv || maxWorkersEnv <= 0) {
      return availableCPUs;
    }

    // Use the minimum of MAX_WORKERS and available CPUs
    return Math.min(maxWorkersEnv, availableCPUs);
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Set up global error handlers
      this.setupGlobalErrorHandlers();

      // Start primary or worker process
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
    process.on('uncaughtException', (error: SystemError) => {
      logger.error('Uncaught Exception:', error);
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        logger.warn('Connection was closed abruptly by the client');
        return;
      }
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
    logger.info(`Total CPU cores available: ${os.cpus().length}`);
    logger.info(`Starting ${this.numCPUs} workers...`);

    // Log system information
    this.logSystemInfo();

    // Fork workers
    for (let i = 0; i < this.numCPUs; i++) {
      this.forkWorker();
    }

    // Setup monitoring and handlers
    this.setupWorkerMonitoring();
    this.setupPrimarySignalHandlers();
    this.startHealthChecks();
  }

  /**
   * Log system information
   */
  private logSystemInfo(): void {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    logger.info('System Information:');
    logger.info(
      `Memory - Total: ${this.formatBytes(totalMemory)}, Used: ${this.formatBytes(
        usedMemory,
      )}, Free: ${this.formatBytes(freeMemory)}`,
    );
    logger.info(`Architecture: ${os.arch()}`);
    logger.info(`Platform: ${os.platform()}`);
    logger.info(`OS: ${os.type()} ${os.release()}`);
    logger.info(`Node.js Version: ${process.version}`);
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
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
      if (message === 'health_ok') {
        this.handleHealthCheckResponse(worker.process.pid!);
      }
    });

    worker.on('error', (error) => {
      logger.error(`Worker ${worker.process.pid} error:`, error);
    });
  }

  /**
   * Setup worker monitoring
   */
  private setupWorkerMonitoring(): void {
    cluster.on('exit', (worker, code, signal) => {
      const pid = worker.process.pid!;
      this.workers.delete(pid);
      this.healthCheckTimers.delete(pid);

      logger.info(`Worker ${pid} died. Signal: ${signal}. Code: ${code}`);

      if (!this.isShuttingDown) {
        logger.info('Starting a new worker...');
        this.forkWorker();
      }
    });
  }

  /**
   * Setup primary signal handlers
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
   * Handle health check response
   */
  private handleHealthCheckResponse(pid: number): void {
    const timer = this.healthCheckTimers.get(pid);
    if (timer) {
      clearTimeout(timer);
      this.healthCheckTimers.delete(pid);
    }
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    setInterval(() => {
      if (this.isShuttingDown) return;

      this.workers.forEach((worker, pid) => {
        try {
          worker.send('health_check');

          // Clear any existing timer
          const existingTimer = this.healthCheckTimers.get(pid);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          // Set new timer
          const timer = setTimeout(() => {
            if (this.isShuttingDown) return;

            logger.error(`Worker ${pid} health check failed. Restarting worker.`);
            try {
              worker.kill('SIGTERM');
            } catch (error) {
              logger.error(`Error killing worker ${pid}:`, error);
            }
          }, this.healthCheckTimeout);

          this.healthCheckTimers.set(pid, timer);
        } catch (error) {
          logger.error(`Error sending health check to worker ${pid}:`, error);
        }
      });
    }, this.healthCheckInterval);
  }

  /**
   * Start worker process
   */
  private async startWorker(): Promise<void> {
    this.startupTimeout = setTimeout(() => {
      logger.error('Worker startup timeout exceeded. Exiting.');
      process.exit(1);
    }, 30000);

    try {
      // Initialize services
      await serviceManager.initializeServices();

      // Create HTTP server
      const httpServer = createServer(app);

      // Handle server errors
      httpServer.on('error', (error: SystemError) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${this.port} is already in use`);
          process.exit(1);
        } else {
          logger.error('Server error:', error);
        }
      });

      // Start listening
      httpServer.listen(this.port, () => {
        if (this.startupTimeout) {
          clearTimeout(this.startupTimeout);
          this.startupTimeout = null;
        }
        logger.info(`Worker ${process.pid} is running on port ${this.port}`);
        if (process.send) {
          process.send('ready');
        }
      });

      // Assign server instance
      this.server = httpServer;

      // Handle process messages
      this.setupWorkerMessageHandlers();
    } catch (error) {
      if (this.startupTimeout) {
        clearTimeout(this.startupTimeout);
      }
      logger.error('Worker startup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Setup worker message handlers
   */
  private setupWorkerMessageHandlers(): void {
    process.on('message', async (msg: string) => {
      if (this.isShuttingDown) return;

      switch (msg) {
        case 'shutdown':
          await this.gracefulWorkerShutdown();
          break;
        case 'health_check':
          if (process.send) {
            try {
              process.send('health_ok');
            } catch (error) {
              logger.error('Error sending health check response:', error);
            }
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

    // Clear all health check timers
    for (const timer of this.healthCheckTimers.values()) {
      clearTimeout(timer);
    }
    this.healthCheckTimers.clear();

    // Notify all workers to stop accepting new connections
    const workerShutdowns = Array.from(this.workers.values()).map((worker) => {
      return new Promise<void>((resolve) => {
        const shutdownTimeout = setTimeout(() => {
          logger.warn(`Worker ${worker.process.pid} did not shut down gracefully. Force killing.`);
          worker.kill('SIGKILL');
          resolve();
        }, this.shutdownTimeout);

        worker.once('exit', () => {
          clearTimeout(shutdownTimeout);
          resolve();
        });

        try {
          worker.send('shutdown');
        } catch (error) {
          logger.error(`Error sending shutdown signal to worker ${worker.process.pid}:`, error);
          clearTimeout(shutdownTimeout);
          worker.kill('SIGKILL');
          resolve();
        }
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
    if (this.isShuttingDown) return;

    try {
      this.isShuttingDown = true;
      logger.info(`Worker ${process.pid} is starting graceful shutdown...`);

      // Stop accepting new connections
      if (this.server) {
        await new Promise<void>((resolve) => {
          const forceShutdown = setTimeout(() => {
            logger.warn(`Worker ${process.pid} force closing server after timeout`);
            resolve();
          }, 5000);

          this.server?.close(() => {
            clearTimeout(forceShutdown);
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
