// src/types/redis.ts
export interface RedisSetOptions {
  EX?: number;
  NX?: boolean;
}

export interface SessionData {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  createdAt: Date;
  lastActive: Date;
}
