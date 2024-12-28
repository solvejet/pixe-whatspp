// src/config/redis-adapter.ts

import { createAdapter } from '@socket.io/redis-adapter';
import type { RedisClientType, RedisDefaultModules, RedisFunctions, RedisScripts } from 'redis';
import { Redis } from '@/config/redis.js';
import { logger } from '@/utils/logger.js';

type RedisClient = RedisClientType<RedisDefaultModules, RedisFunctions, RedisScripts>;

interface RedisClients {
  pubClient: RedisClient;
  subClient: RedisClient;
}

export class RedisAdapter {
  /**
   * Create Redis pub/sub clients for Socket.IO adapter
   */
  private static async createRedisClients(): Promise<RedisClients> {
    try {
      // Create pub/sub clients
      const pubClient = Redis.getDuplicateInstance();
      const subClient = Redis.getDuplicateInstance();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      return { pubClient, subClient };
    } catch (error) {
      logger.error('Error creating Redis adapter clients:', error);
      throw error;
    }
  }

  /**
   * Create Socket.IO Redis adapter
   */
  public static async createAdapter(): Promise<ReturnType<typeof createAdapter>> {
    const { pubClient, subClient } = await RedisAdapter.createRedisClients();
    return createAdapter(pubClient, subClient);
  }
}
