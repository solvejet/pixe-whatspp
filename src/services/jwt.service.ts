// src/services/jwt.service.ts
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { DecodedToken, JWTTokens, TokenMetadata, TokenConfig } from '@/types/jwt.js';
import { Redis } from '@/config/redis.js';
import { logger } from '@/utils/logger.js';
import { env } from '@/config/env.js';
import { ErrorCode, AppError, AuthenticationError } from '@/utils/error-service.js';

export class JWTService {
  private static instance: JWTService | null = null;
  private readonly TOKEN_VERSION_PREFIX = 'token:version:';
  private readonly TOKEN_WHITELIST_PREFIX = 'token:whitelist:';
  private readonly TOKEN_BLACKLIST_PREFIX = 'token:blacklist:';

  private readonly accessTokenConfig: TokenConfig = {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'auth-service',
    audience: 'access',
  };

  private readonly refreshTokenConfig: TokenConfig = {
    secret: env.JWT_REFRESH_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: 'auth-service',
    audience: 'refresh',
  };

  private constructor() {}

  public static getInstance(): JWTService {
    if (!JWTService.instance) {
      JWTService.instance = new JWTService();
    }
    return JWTService.instance;
  }

  public async generateTokens(
    payload: Omit<DecodedToken, 'iat' | 'exp' | 'jti'>,
    metadata: TokenMetadata,
  ): Promise<JWTTokens> {
    try {
      const jti = randomUUID();
      const tokenVersion = await this.getTokenVersion(payload.userId);

      const basePayload = {
        ...payload,
        jti,
        tokenVersion,
      };

      const accessToken = this.signToken(basePayload, this.accessTokenConfig);
      const refreshToken = this.signToken(basePayload, this.refreshTokenConfig);

      // Store token metadata
      await this.storeTokenMetadata(jti, payload.userId, metadata);

      return { accessToken, refreshToken };
    } catch (error) {
      logger.error('Error generating tokens:', error);
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to generate tokens', 500, true);
    }
  }

  public async verifyToken(token: string, isRefresh = false): Promise<DecodedToken> {
    try {
      const config = isRefresh ? this.refreshTokenConfig : this.accessTokenConfig;
      const decoded = jwt.verify(token, config.secret) as DecodedToken & {
        jti: string;
      };

      // Verify audience
      if (decoded.aud !== config.audience) {
        throw new AuthenticationError('Invalid token type');
      }

      // Check if token is blacklisted
      const isBlacklisted = await Redis.get(`${this.TOKEN_BLACKLIST_PREFIX}${decoded.jti}`);
      if (isBlacklisted) {
        throw new AuthenticationError('Token has been revoked');
      }

      // Verify token version
      const currentVersion = await this.getTokenVersion(decoded.userId);
      if (decoded.tokenVersion !== currentVersion) {
        throw new AuthenticationError('Token version is invalid');
      }

      return decoded;
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token has expired');
      }

      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      }

      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Token verification failed', 500, true);
    }
  }

  public async revokeToken(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as DecodedToken & { jti: string; exp: number };
      if (!decoded || !decoded.jti) {
        throw new AuthenticationError('Invalid token format');
      }

      const timeToExpiry = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
      await Redis.setEx(`${this.TOKEN_BLACKLIST_PREFIX}${decoded.jti}`, timeToExpiry, '1');

      // Remove from whitelist if exists
      await Redis.del(`${this.TOKEN_WHITELIST_PREFIX}${decoded.jti}`);
    } catch (error) {
      logger.error('Error revoking token:', error);
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to revoke token', 500, true);
    }
  }

  public async invalidateAllUserTokens(userId: string): Promise<void> {
    try {
      const currentVersion = await this.getTokenVersion(userId);
      await Redis.set(
        `${this.TOKEN_VERSION_PREFIX}${userId}`,
        (currentVersion + 1).toString(),
        { EX: 7 * 24 * 60 * 60 }, // 7 days
      );
    } catch (error) {
      logger.error('Error invalidating user tokens:', error);
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to invalidate tokens', 500, true);
    }
  }

  private async getTokenVersion(userId: string): Promise<number> {
    const version = await Redis.get(`${this.TOKEN_VERSION_PREFIX}${userId}`);
    return version ? parseInt(version, 10) : 0;
  }

  private signToken(payload: Record<string, unknown>, config: TokenConfig): string {
    return jwt.sign(payload, config.secret, {
      expiresIn: config.expiresIn,
      issuer: config.issuer,
      audience: config.audience,
      algorithm: 'HS256',
    });
  }

  private async storeTokenMetadata(
    jti: string,
    userId: string,
    metadata: TokenMetadata,
  ): Promise<void> {
    const key = `${this.TOKEN_WHITELIST_PREFIX}${jti}`;
    await Redis.set(
      key,
      JSON.stringify({
        userId,
        ...metadata,
        createdAt: new Date().toISOString(),
      }),
      { EX: 7 * 24 * 60 * 60 },
    ); // 7 days
  }
}

export const jwtService = JWTService.getInstance();
