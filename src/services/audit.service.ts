// src/services/audit.service.ts

import { UAParser } from 'ua-parser-js';
import { Types } from 'mongoose';
import type { Channel } from 'amqplib';
import { AuditLogModel } from '@/models/audit.model.js';
import type { IAuditService, IAuditLogData } from '@/types/audit.js';
import { logger } from '@/utils/logger.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';

export class AuditService implements IAuditService {
  private static instance: AuditService;

  // Configuration constants
  private readonly QUEUE_NAME = 'audit_logs';
  private readonly CHANNEL_ID = 'audit-service';
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_RETRIES = 3;
  private readonly SYSTEM_USER_ID = '000000000000000000000000'; // 24-character hex string

  // Service state
  private logQueue: IAuditLogData[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private readonly uaParser: UAParser;
  private channel: Channel | null = null;

  private readonly QUEUE_OPTIONS = {
    durable: true,
    maxPriority: 10,
    arguments: {
      'x-message-ttl': 86400000, // 24 hours
      'x-max-length': 1000000, // Maximum queue length
      'x-overflow': 'reject-publish',
      'x-queue-mode': 'lazy', // Optimize for throughput over latency
    },
  } as const;

  private constructor() {
    this.uaParser = new UAParser();
    void this.initialize();
  }

  /**
   * Get singleton instance of AuditService
   */
  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /**
   * Initialize the audit service
   * Sets up RabbitMQ connection and starts consumer
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing audit service...');

      // Create and configure channel
      this.channel = await RabbitMQ.createChannel(this.CHANNEL_ID);
      await RabbitMQ.assertQueue(this.channel, this.QUEUE_NAME, this.QUEUE_OPTIONS);

      // Set up message consumer
      await this.setupConsumer();

      this.isInitialized = true;
      logger.info('Audit service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize audit service:', error);

      // Schedule reconnection
      this.scheduleReconnection();
    }
  }

  /**
   * Schedule service reconnection
   */
  private scheduleReconnection(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect audit service...');
      void this.initialize();
    }, this.RECONNECT_DELAY);
  }

  /**
   * Set up RabbitMQ message consumer
   */
  private async setupConsumer(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not available');
    }

    // Set prefetch for better load balancing
    await this.channel.prefetch(this.BATCH_SIZE);

    await this.channel.consume(
      this.QUEUE_NAME,
      async (msg) => {
        if (!msg) return;

        try {
          const logData = JSON.parse(msg.content.toString()) as IAuditLogData;
          await this.saveLog(logData);
          this.channel?.ack(msg);
        } catch (error) {
          logger.error('Error processing audit log:', error);

          if (error instanceof SyntaxError) {
            // Invalid message format - reject permanently
            this.channel?.reject(msg, false);
          } else {
            // Other errors - requeue for retry
            this.channel?.nack(msg, false, true);
          }
        }
      },
      { noAck: false },
    );
  }

  /**
   * Save audit log to database
   */
  private async saveLog(logData: IAuditLogData, retryCount = 0): Promise<void> {
    try {
      // Validate and normalize user ID
      const userId =
        logData.userId === 'system' || logData.userId === 'unknown'
          ? this.SYSTEM_USER_ID
          : logData.userId;

      const validatedLogData = {
        ...logData,
        userId: new Types.ObjectId(userId),
      };

      await AuditLogModel.create(validatedLogData);
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        logger.warn(`Retrying audit log save. Attempt ${retryCount + 1}/${this.MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return await this.saveLog(logData, retryCount + 1);
      }

      logger.error('Error saving audit log after retries:', error);
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Failed to save audit log', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          logData,
        },
      });
    }
  }

  /**
   * Log an audit event
   * Main public interface for the service
   */
  public log(params: {
    userId: string;
    action: string;
    category: 'auth' | 'user' | 'system' | 'data' | 'security';
    details: Record<string, unknown>;
    ipAddress: string;
    userAgent: string;
    status: 'success' | 'failure';
  }): Promise<void> {
    try {
      // Parse user agent
      const parsedUA = this.parseUserAgent(params.userAgent);

      // Prepare log data
      const logData: IAuditLogData = {
        userId:
          params.userId === 'system' || params.userId === 'unknown'
            ? this.SYSTEM_USER_ID
            : new Types.ObjectId(params.userId),
        action: params.action,
        category: params.category,
        details: this.sanitizeDetails(params.details),
        ipAddress: params.ipAddress,
        userAgent: {
          browser: parsedUA.browser.name ?? 'unknown',
          version: parsedUA.browser.version ?? 'unknown',
          os: parsedUA.os.name ?? 'unknown',
          platform: parsedUA.device.type ?? 'desktop',
        },
        status: params.status,
        createdAt: new Date(),
      };

      // Add to queue for batch processing
      this.logQueue.push(logData);

      // Create a promise that resolves when the log is queued or flushed
      return new Promise<void>((resolve) => {
        if (this.logQueue.length >= this.BATCH_SIZE) {
          void this.flushLogs().then(resolve);
        } else {
          this.scheduleFlush();
          resolve();
        }
      });
    } catch (error) {
      logger.error('Error queuing audit log:', error);
      return Promise.reject(error);
    }
  }

  /**
   * Schedule a flush of the log queue
   */
  private scheduleFlush(): void {
    if (this.flushTimeout === null) {
      this.flushTimeout = setTimeout(() => {
        void this.flushLogs();
      }, this.FLUSH_INTERVAL);
    }
  }

  /**
   * Flush queued logs to database
   */
  private async flushLogs(): Promise<void> {
    if (this.logQueue.length === 0) {
      this.flushTimeout = null;
      return;
    }

    const logsToProcess = this.logQueue.splice(0, this.BATCH_SIZE);

    try {
      if (!this.channel) {
        this.channel = await RabbitMQ.createChannel(this.CHANNEL_ID);
      }

      // Process logs in batches
      await AuditLogModel.insertMany(logsToProcess, {
        ordered: false,
        lean: true,
      });
    } catch (error) {
      logger.error('Error flushing audit logs:', error);
      // Return logs to queue for retry
      this.logQueue.unshift(...logsToProcess);
      this.channel = null;
    }

    this.flushTimeout = null;
    if (this.logQueue.length > 0) {
      this.scheduleFlush();
    }
  }

  /**
   * Parse user agent string
   */
  private parseUserAgent(userAgent: string): UAParser.IResult {
    this.uaParser.setUA(userAgent);
    return this.uaParser.getResult();
  }

  /**
   * Sanitize log details to prevent sensitive data logging
   */
  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credit_card'];

    return Object.entries(details).reduce(
      (acc, [key, value]) => {
        if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
          acc[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          acc[key] = this.sanitizeDetails(value as Record<string, unknown>);
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  /**
   * Shutdown the service gracefully
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear any pending timeouts
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
      }
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      // Flush remaining logs
      if (this.logQueue.length > 0) {
        await this.flushLogs();
      }

      // Close channel
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      this.isInitialized = false;
      logger.info('Audit service shut down successfully');
    } catch (error) {
      logger.error('Error during audit service shutdown:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const auditService = AuditService.getInstance();
