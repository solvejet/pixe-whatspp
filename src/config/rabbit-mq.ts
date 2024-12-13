// src/config/rabbit-mq.ts
import amqp from 'amqplib';
import type { Channel, Connection } from 'amqplib';
import { logger } from '@/utils/logger.js';

export class RabbitMQService {
  private connection: Connection | null = null;
  private channel: Channel | null = null;

  async initialize(): Promise<Channel> {
    try {
      this.connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      this.channel = await this.connection.createChannel();

      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        logger.info('RabbitMQ connection closed');
      });

      if (!this.channel) {
        throw new Error('Failed to create RabbitMQ channel');
      }

      return this.channel;
    } catch (error) {
      logger.error('Failed to initialize RabbitMQ:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      logger.error('Error disconnecting from RabbitMQ:', error);
      throw error;
    }
  }
}

export const RabbitMQ = new RabbitMQService();

export const initializeRabbitMQ = async (): Promise<Channel> => {
  return await RabbitMQ.initialize();
};
