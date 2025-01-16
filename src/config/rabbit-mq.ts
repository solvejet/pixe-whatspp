// src/config/rabbit-mq.ts
import amqp from 'amqplib';
import type { Channel, Connection, Options } from 'amqplib';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger.js';

export class RabbitMQService extends EventEmitter {
  private connection: Connection | null = null;
  private channels: Map<string, Channel> = new Map();
  private readonly url: string;
  private connectPromise: Promise<Connection> | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private readonly RECONNECT_DELAY = 5000;

  constructor() {
    super();
    this.url = process.env.RABBITMQ_URL ?? 'amqp://localhost';
  }

  public async initialize(): Promise<void> {
    try {
      await this.getConnection();
      await this.createChannel('default');
    } catch (error) {
      logger.error('Failed to initialize RabbitMQ:', error);
      throw error;
    }
  }

  private async getConnection(): Promise<Connection> {
    if (this.connection?.connection?.serverProperties) {
      return this.connection;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    this.connectPromise = this.connect();

    try {
      this.connection = await this.connectPromise;
      return this.connection;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connect(): Promise<Connection> {
    try {
      const connection = await amqp.connect(this.url);

      connection.on('error', (error) => {
        logger.error('RabbitMQ connection error:', error);
        void this.handleConnectionFailure();
      });

      connection.on('close', () => {
        logger.info('RabbitMQ connection closed');
        void this.handleConnectionFailure();
      });

      this.emit('connected');
      return connection;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  private handleConnectionFailure(): void {
    this.connection = null;
    this.channels.clear();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect to RabbitMQ...');
      void this.getConnection();
    }, this.RECONNECT_DELAY);
  }

  public async createChannel(id: string): Promise<Channel> {
    try {
      const existingChannel = this.channels.get(id);
      if (existingChannel?.connection.connection.serverProperties) {
        return existingChannel;
      }

      const connection = await this.connect();
      const channel = await connection.createChannel();

      channel.on('error', (error) => {
        logger.error(`Channel ${id} error:`, error);
        this.channels.delete(id);
      });

      channel.on('close', () => {
        logger.info(`Channel ${id} closed`);
        this.channels.delete(id);
      });

      this.channels.set(id, channel);
      return channel;
    } catch (error) {
      logger.error(`Error creating channel ${id}:`, error);
      throw error;
    }
  }

  public async assertQueue(
    channel: Channel,
    queueName: string,
    options: Options.AssertQueue,
  ): Promise<void> {
    try {
      await channel.assertQueue(queueName, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('PRECONDITION_FAILED')) {
        // Queue exists with different options, need to recreate
        logger.info(`Queue ${queueName} exists with different options. Recreating...`);

        // Create a new channel specifically for deletion
        const deleteChannel = await this.createChannel(`delete-${queueName}`);
        try {
          await deleteChannel.deleteQueue(queueName);
          await deleteChannel.close();
        } catch (deleteError) {
          logger.error(`Error deleting queue ${queueName}:`, deleteError);
          throw deleteError;
        }

        // Create a new channel and assert queue with desired options
        const newChannel = await this.createChannel(`assert-${queueName}`);
        await newChannel.assertQueue(queueName, options);
        return;
      }
      throw error;
    }
  }

  public async closeChannel(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (channel) {
      try {
        await channel.close();
      } catch (error) {
        logger.error(`Error closing channel ${id}:`, error);
      } finally {
        this.channels.delete(id);
      }
    }
  }

  public async disconnect(): Promise<void> {
    // Close all channels
    for (const [id, channel] of this.channels.entries()) {
      try {
        await channel.close();
        this.channels.delete(id);
      } catch (error) {
        logger.error(`Error closing channel ${id}:`, error);
      }
    }

    // Close connection
    if (this.connection) {
      try {
        await this.connection.close();
        this.connection = null;
      } catch (error) {
        logger.error('Error closing RabbitMQ connection:', error);
      }
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

export const RabbitMQ = new RabbitMQService();

export const initializeRabbitMQ = async (): Promise<void> => {
  try {
    await RabbitMQ.createChannel('default');
  } catch (error) {
    logger.error('Failed to initialize RabbitMQ:', error);
    throw error;
  }
};
