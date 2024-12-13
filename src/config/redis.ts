// src/config/redis.ts
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { logger } from '@/utils/logger.js';
import type { SessionData } from '@/types/redis.js';

class RedisService {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries: number): Error | number => {
          if (retries > 10) {
            logger.error('Redis max reconnection attempts reached');
            return new Error('Redis max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connecting');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      logger.info('Redis client connected and ready');
    });

    this.client.on('error', (err: Error) => {
      this.isConnected = false;
      logger.error('Redis Client Error:', err);
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.info('Redis client disconnected');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Redis connection error:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  async setSession(
    userId: string,
    sessionData: SessionData,
    expiryInSeconds: number,
  ): Promise<void> {
    await this.client.setEx(`session:${userId}`, expiryInSeconds, JSON.stringify(sessionData));
  }

  async getSession(userId: string): Promise<SessionData | null> {
    const session = await this.client.get(`session:${userId}`);
    return session ? (JSON.parse(session) as SessionData) : null;
  }

  async deleteSession(userId: string): Promise<void> {
    await this.client.del(`session:${userId}`);
  }

  async blacklistToken(token: string, expiryInSeconds: number): Promise<void> {
    await this.client.setEx(`blacklist:${token}`, expiryInSeconds, '1');
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    return (await this.client.exists(`blacklist:${token}`)) === 1;
  }

  async incrementRateLimit(key: string, expiryInSeconds: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    multi.expire(key, expiryInSeconds);
    const results = await multi.exec();
    return (results?.[0] as number) || 0;
  }

  async set(key: string, value: string, expiresInSeconds?: number): Promise<void> {
    if (expiresInSeconds) {
      await this.client.setEx(key, expiresInSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

export const Redis = new RedisService();
