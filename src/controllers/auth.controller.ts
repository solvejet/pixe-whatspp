// src/controllers/auth.controller.ts
import type { Response } from 'express';
import type {
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
  LogoutRequest,
  AuthenticatedRequest,
  DeviceInfo,
} from '@/types/auth.js';
import { AuthService } from '@/services/auth.service.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import { jwtService } from '@/services/jwt.service.js';
import { Redis } from '@/config/redis.js';
import { UAParser } from 'ua-parser-js';

/**
 * Authentication Controller with enhanced security and rate limiting
 */
export class AuthController {
  private readonly authService: AuthService;
  private readonly LOGIN_ATTEMPTS_PREFIX = 'login:attempts:';
  private readonly LOGIN_BLOCK_PREFIX = 'login:block:';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly BLOCK_DURATION = 15 * 60; // 15 minutes in seconds
  private readonly uaParser: UAParser;

  constructor() {
    this.authService = new AuthService();
    this.uaParser = new UAParser();
  }

  /**
   * Register a new user
   * @route POST /api/auth/register
   */
  public register = async (req: RegisterRequest, res: Response): Promise<void> => {
    const deviceInfo = this.extractDeviceInfo(req);
    const result = await this.authService.register(req.body, req.user);

    const tokens = await jwtService.generateTokens(
      {
        userId: result.user._id.toString(),
        email: result.user.email,
        roles: result.user.roles,
        permissions: result.user.permissions,
      },
      {
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        deviceId: deviceInfo.deviceId,
      },
    );

    successResponse(res, { ...result, ...tokens }, 'Registration successful', 201);
  };

  /**
   * Login user with brute force protection
   * @route POST /api/auth/login
   */
  public login = async (req: LoginRequest, res: Response): Promise<void> => {
    const { email, password } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    const isBlocked = await this.checkLoginBlock(ip);
    if (isBlocked) {
      throw new AppError(
        ErrorCode.ACCOUNT_LOCKED,
        'Too many failed attempts. Please try again later.',
        423,
      );
    }

    try {
      const deviceInfo = this.extractDeviceInfo(req);
      const result = await this.authService.login(
        email,
        password,
        ip,
        req.headers['user-agent'] || '',
        deviceInfo,
      );
      await this.resetLoginAttempts(ip);
      successResponse(res, result, 'Login successful');
    } catch (error) {
      await this.handleFailedLogin(ip);
      throw error;
    }
  };

  /**
   * Refresh access token
   * @route POST /api/auth/refresh-token
   */
  public refreshToken = async (req: RefreshTokenRequest, res: Response): Promise<void> => {
    const { refreshToken } = req.body;
    const deviceInfo = this.extractDeviceInfo(req);

    const result = await this.authService.refreshToken(refreshToken);

    const tokens = await jwtService.generateTokens(
      {
        userId: result.user._id.toString(),
        email: result.user.email,
        roles: result.user.roles,
        permissions: result.user.permissions,
      },
      {
        ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        deviceId: deviceInfo.deviceId,
      },
    );

    successResponse(res, { ...result, ...tokens }, 'Token refreshed successfully');
  };

  /**
   * Logout user
   * @route POST /api/auth/logout
   */
  public logout = async (req: LogoutRequest, res: Response): Promise<void> => {
    const { refreshToken, allDevices } = req.body;

    if (allDevices && req.user) {
      await jwtService.invalidateAllUserTokens(req.user.userId);
    } else {
      await jwtService.revokeToken(refreshToken);
    }

    successResponse(res, { success: true }, 'Logout successful');
  };

  /**
   * Extract device information from request with proper type handling
   */
  private extractDeviceInfo(
    req: AuthenticatedRequest & { body: { deviceInfo?: Partial<DeviceInfo> } },
  ): DeviceInfo {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    this.uaParser.setUA(userAgent);
    const result = this.uaParser.getResult();

    const deviceId =
      req.body.deviceInfo?.deviceId ||
      Buffer.from(`${ip}-${userAgent}-${Date.now()}`).toString('base64');

    return {
      deviceId,
      deviceType: req.body.deviceInfo?.deviceType || result.device.type || 'web',
      deviceName: req.body.deviceInfo?.deviceName || result.device.model || userAgent,
      platform: req.body.deviceInfo?.platform || result.os.name || 'web',
      browserName: req.body.deviceInfo?.browserName || result.browser.name || 'unknown',
      browserVersion: req.body.deviceInfo?.browserVersion || result.browser.version || 'unknown',
      ipAddress: ip,
      location: req.body.deviceInfo?.location,
    };
  }

  /**
   * Check if login is blocked for an IP
   */
  private async checkLoginBlock(ip: string): Promise<boolean> {
    return Boolean(await Redis.get(`${this.LOGIN_BLOCK_PREFIX}${ip}`));
  }

  /**
   * Handle failed login attempt
   */
  private async handleFailedLogin(ip: string): Promise<void> {
    const attemptsKey = `${this.LOGIN_ATTEMPTS_PREFIX}${ip}`;
    const attempts = await Redis.get(attemptsKey);
    const currentAttempts = attempts ? parseInt(attempts, 10) + 1 : 1;

    if (currentAttempts >= this.MAX_LOGIN_ATTEMPTS) {
      await Redis.setEx(`${this.LOGIN_BLOCK_PREFIX}${ip}`, this.BLOCK_DURATION, '1');
      await Redis.del(attemptsKey);

      logger.warn('IP blocked due to too many failed login attempts:', {
        ip,
        attempts: currentAttempts,
      });
    } else {
      await Redis.setEx(attemptsKey, this.BLOCK_DURATION, currentAttempts.toString());
    }
  }

  /**
   * Reset login attempts for an IP
   */
  private async resetLoginAttempts(ip: string): Promise<void> {
    await Redis.del(`${this.LOGIN_ATTEMPTS_PREFIX}${ip}`);
  }
}
