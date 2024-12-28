// src/config/redis.ts
import { env } from '@/config/env.js';
import { createClient } from 'redis';
import type {
  RedisClientType,
  RedisDefaultModules,
  RedisFunctions,
  RedisScripts,
  SetOptions,
} from 'redis';
import { logger } from '@/utils/logger.js';
import type { SessionData } from '@/types/redis.js';

type RedisClient = RedisClientType<RedisDefaultModules, RedisFunctions, RedisScripts>;
type RedisValue = string | number | Buffer;

class RedisService {
  private client: RedisClient;
  private isConnected: boolean = false;
  private readonly reconnectMaxAttempts = 10;
  private readonly reconnectBaseDelay = 100;
  private readonly reconnectMaxDelay = 3000;

  constructor() {
    this.client = this.createRedisClient();
    this.setupEventHandlers(this.client);
  }

  /**
   * Create a new Redis client with default configuration
   */
  private createRedisClient(): RedisClient {
    return createClient({
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD,
      socket: {
        reconnectStrategy: (retries: number): Error | number => {
          if (retries > this.reconnectMaxAttempts) {
            return new Error('Redis max reconnection attempts reached');
          }
          return Math.min(retries * this.reconnectBaseDelay, this.reconnectMaxDelay);
        },
      },
    });
  }

  public async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    try {
      return await this.client.hIncrBy(key, field, increment);
    } catch (error) {
      logger.error('Redis hIncrBy error:', error);
      throw error;
    }
  }

  public async sAdd(key: string, member: string): Promise<number> {
    try {
      return await this.client.sAdd(key, member);
    } catch (error) {
      logger.error('Redis sAdd error:', error);
      throw error;
    }
  }

  public async hSet(key: string, data: Record<string, string>): Promise<number> {
    try {
      return await this.client.hSet(key, data);
    } catch (error) {
      logger.error('Redis hSet error:', error);
      throw error;
    }
  }

  public async setExpiry(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Redis setExpiry error:', error);
      throw error;
    }
  }

  /**
   * Create a duplicate Redis client instance
   * Useful for pub/sub functionality
   */
  public getDuplicateInstance(): RedisClient {
    const duplicateClient = this.createRedisClient();
    this.setupEventHandlers(duplicateClient);
    return duplicateClient;
  }

  private setupEventHandlers(client: RedisClient): void {
    client.on('connect', () => {
      logger.info('Redis client connecting');
    });

    client.on('ready', () => {
      this.isConnected = true;
      logger.info('Redis client connected and ready');
    });

    client.on('error', (err: Error) => {
      this.isConnected = false;
      logger.error('Redis Client Error:', err);
    });

    client.on('end', () => {
      this.isConnected = false;
      logger.info('Redis client disconnected');
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      try {
        await this.client.connect();
      } catch (error) {
        logger.error('Redis connection error:', error);
        throw error;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
      } catch (error) {
        logger.error('Redis disconnect error:', error);
        throw error;
      }
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.client.keys(pattern);
      return keys;
    } catch (error) {
      logger.error('Redis keys error:', error);
      return [];
    }
  }

  /**
   * Delete multiple keys
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    try {
      await this.client.del(keys);
    } catch (error) {
      logger.error('Redis deleteMany error:', error);
      throw error;
    }
  }

  async set(
    key: string,
    value: RedisValue,
    options?: number | Partial<SetOptions>,
  ): Promise<boolean> {
    try {
      if (typeof options === 'number') {
        await this.client.set(key, value.toString(), { EX: options });
      } else if (options) {
        await this.client.set(key, value.toString(), options);
      } else {
        await this.client.set(key, value.toString());
      }
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  }

  async setEx(key: string, seconds: number, value: RedisValue): Promise<boolean> {
    try {
      await this.client.setEx(key, seconds, value.toString());
      return true;
    } catch (error) {
      logger.error('Redis setEx error:', error);
      return false;
    }
  }

  async setSession(
    userId: string,
    sessionData: SessionData,
    expiryInSeconds: number,
  ): Promise<void> {
    try {
      await this.setEx(`session:${userId}`, expiryInSeconds, JSON.stringify(sessionData));
    } catch (error) {
      logger.error('Redis setSession error:', error);
      throw error;
    }
  }

  async getSession(userId: string): Promise<SessionData | null> {
    try {
      const session = await this.client.get(`session:${userId}`);
      return session ? (JSON.parse(session) as SessionData) : null;
    } catch (error) {
      logger.error('Redis getSession error:', error);
      throw error;
    }
  }

  async deleteSession(userId: string): Promise<void> {
    try {
      await this.client.del(`session:${userId}`);
    } catch (error) {
      logger.error('Redis deleteSession error:', error);
      throw error;
    }
  }

  async blacklistToken(token: string, expiryInSeconds: number): Promise<void> {
    try {
      await this.setEx(`blacklist:${token}`, expiryInSeconds, '1');
    } catch (error) {
      logger.error('Redis blacklistToken error:', error);
      throw error;
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      return (await this.client.exists(`blacklist:${token}`)) === 1;
    } catch (error) {
      logger.error('Redis isTokenBlacklisted error:', error);
      throw error;
    }
  }

  async incrementRateLimit(key: string, expiryInSeconds: number): Promise<number> {
    try {
      const multi = this.client.multi();
      multi.incr(key);
      multi.expire(key, expiryInSeconds);
      const results = await multi.exec();
      return (results?.[0] as number) || 0;
    } catch (error) {
      logger.error('Redis incrementRateLimit error:', error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis get error:', error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error('Redis del error:', error);
      throw error;
    }
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    try {
      return await this.client.mGet(keys);
    } catch (error) {
      logger.error('Redis mget error:', error);
      throw error;
    }
  }

  async mset(keyValuePairs: Record<string, string>): Promise<void> {
    try {
      await this.client.mSet(keyValuePairs);
    } catch (error) {
      logger.error('Redis mset error:', error);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping error:', error);
      return false;
    }
  }
}

export const Redis = new RedisService();
