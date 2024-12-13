// src/services/audit.service.ts
import { UAParser } from 'ua-parser-js';
import { Types } from 'mongoose';
import { AuditLogModel } from '@/models/audit.model.js';
import type { IAuditService, IAuditLogData } from '@/types/audit.js';
import { logger } from '@/utils/logger.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';
import type { Channel } from 'amqplib';

export class AuditService implements IAuditService {
  private static instance: AuditService;
  private readonly QUEUE_NAME = 'audit_logs';
  private readonly CHANNEL_ID = 'audit-service';
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000;
  private logQueue: IAuditLogData[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly uaParser: UAParser;
  private channel: Channel | null = null;

  private readonly QUEUE_OPTIONS = {
    durable: true,
    maxPriority: 10,
    arguments: {
      'x-message-ttl': 86400000, // 24 hours
      'x-max-length': 1000000,
      'x-overflow': 'reject-publish',
    },
  };

  private constructor() {
    this.uaParser = new UAParser();
    void this.initialize();
  }

  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  private async initialize(): Promise<void> {
    try {
      // Create a new channel
      this.channel = await RabbitMQ.createChannel(this.CHANNEL_ID);

      // Assert queue with proper error handling
      await RabbitMQ.assertQueue(this.channel, this.QUEUE_NAME, this.QUEUE_OPTIONS);

      // Set up consumer
      await this.setupConsumer();
    } catch (error) {
      logger.error('Failed to initialize audit service:', error);
      // Retry initialization after delay
      setTimeout(() => void this.initialize(), 5000);
    }
  }

  private async setupConsumer(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not available');
    }

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
          // For parse errors, reject immediately
          if (error instanceof SyntaxError) {
            this.channel?.reject(msg, false);
          } else {
            // For other errors, requeue the message
            this.channel?.nack(msg, false, true);
          }
        }
      },
      { noAck: false },
    );
  }

  private async saveLog(logData: IAuditLogData): Promise<void> {
    try {
      await AuditLogModel.create(logData);
    } catch (error) {
      logger.error('Error saving audit log:', error);
      throw error;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout === null) {
      this.flushTimeout = setTimeout(() => {
        void this.flushLogs();
      }, this.FLUSH_INTERVAL);
    }
  }

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

      for (const log of logsToProcess) {
        await this.channel.sendToQueue(this.QUEUE_NAME, Buffer.from(JSON.stringify(log)), {
          persistent: true,
          priority: log.category === 'security' ? 10 : 5,
        });
      }
    } catch (error) {
      logger.error('Error flushing audit logs:', error);
      this.logQueue.unshift(...logsToProcess);
      this.channel = null; // Force channel recreation on next attempt
    }

    this.flushTimeout = null;
    if (this.logQueue.length > 0) {
      this.scheduleFlush();
    }
  }

  public async log(params: {
    userId: string;
    action: string;
    category: 'auth' | 'user' | 'system' | 'data' | 'security';
    details: Record<string, unknown>;
    ipAddress: string;
    userAgent: string;
    status: 'success' | 'failure';
  }): Promise<void> {
    const parsedUA = this.parseUserAgent(params.userAgent);

    const logData: IAuditLogData = {
      userId: new Types.ObjectId(params.userId),
      action: params.action,
      category: params.category,
      details: params.details,
      ipAddress: params.ipAddress,
      userAgent: {
        browser: parsedUA.browser.name || 'unknown',
        version: parsedUA.browser.version || 'unknown',
        os: parsedUA.os.name || 'unknown',
        platform: parsedUA.device.type || 'desktop',
      },
      status: params.status,
      createdAt: new Date(),
    };

    this.logQueue.push(logData);

    if (this.logQueue.length >= this.BATCH_SIZE) {
      void this.flushLogs();
    } else {
      this.scheduleFlush();
    }
  }

  private parseUserAgent(userAgent: string): UAParser.IResult {
    this.uaParser.setUA(userAgent);
    return this.uaParser.getResult();
  }
}

export const auditService = AuditService.getInstance();
