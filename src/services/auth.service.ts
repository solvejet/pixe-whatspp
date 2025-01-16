import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserModel } from '@/models/user.model.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { Redis } from '@/config/redis.js';
import { jwtService } from '@/services/jwt.service.js';
import { auditService } from '@/services/audit.service.js';
import {
  type IUserDocument,
  type IUserResponse,
  type ILoginResponse,
  type RegisterRequestBody,
  type ITokenPayload,
  Role,
  type AuthUser,
  type DeviceInfo,
} from '@/types/auth.js';

/**
 * Service handling user authentication operations with enhanced security
 */
export class AuthService {
  private readonly BLOCK_DURATION = 15 * 60; // 15 minutes in seconds
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly SALT_ROUNDS = 12;
  private readonly SESSION_PREFIX = 'session:';
  private readonly BLOCK_PREFIX = 'block:';
  private readonly ATTEMPTS_PREFIX = 'attempts:';

  /**
   * Format user response by removing sensitive data
   * @param user - The user document from MongoDB
   * @returns Formatted user response without sensitive data
   */

  private formatUserResponse(user: IUserDocument): IUserResponse {
    return {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      permissions: user.permissions,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * User login with security measures and rate limiting
   * @throws {AppError} If login fails or account is locked
   */
  public async login(
    email: string,
    password: string,
    ipAddress: string,
    userAgent: string,
    deviceInfo?: Partial<DeviceInfo>,
  ): Promise<ILoginResponse> {
    try {
      // Check if user exists with password field
      const user = await UserModel.findOne({ email }).select('+password');
      if (!user) {
        logger.debug(`Login attempt failed: User not found - ${email}`);
        throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
      }

      // Check if user is active
      if (!user.isActive) {
        logger.warn(`Login attempt for inactive account: ${email}`);
        throw new AppError(ErrorCode.ACCOUNT_LOCKED, 'Account is inactive', 401);
      }

      const userId = user._id.toString();

      // Check for account lockout
      const isBlocked = await this.isUserBlocked(userId);
      if (isBlocked) {
        throw new AppError(
          ErrorCode.ACCOUNT_LOCKED,
          'Account temporarily locked. Please try again later',
          423,
        );
      }

      // Verify password with timing-safe comparison
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        await this.handleFailedLoginAttempt(userId);
        throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials', 401);
      }

      // Reset login attempts on successful login
      await this.resetLoginAttempts(userId);

      // Update last login and save
      user.lastLogin = new Date();
      await user.save();

      // Generate tokens with device info
      const tokens = await this.generateAuthTokens(user, {
        ipAddress,
        userAgent,
        deviceInfo,
      });

      // Create session
      await this.createUserSession(userId, {
        deviceInfo,
        ipAddress,
        userAgent,
      });

      // Log successful login
      await this.logAuthEvent(user, 'login', 'success', {
        ipAddress,
        userAgent,
        deviceInfo,
      });

      return {
        ...tokens,
        user: this.formatUserResponse(user),
        expiresIn: 900, // 15 minutes in seconds
      };
    } catch (error) {
      if (error instanceof AppError) {
        await this.logAuthEvent({ email, _id: 'unknown' }, 'login', 'failure', {
          ipAddress,
          userAgent,
          deviceInfo,
          error: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Register new user with role validation
   * @throws {AppError} If registration fails or validation errors occur
   */
  public async register(
    userData: RegisterRequestBody,
    currentUser?: ITokenPayload,
  ): Promise<ILoginResponse> {
    try {
      // Validate admin/staff role assignment
      if (userData.roles?.some((role) => [Role.ADMIN, Role.STAFF].includes(role))) {
        if (!currentUser?.roles.includes(Role.ADMIN)) {
          throw new AppError(
            ErrorCode.INSUFFICIENT_PERMISSIONS,
            'Only administrators can create admin or staff accounts',
            403,
          );
        }
      }

      // Check if email exists
      const existingUser = await UserModel.findOne({ email: userData.email });
      if (existingUser) {
        throw new AppError(ErrorCode.RESOURCE_ALREADY_EXISTS, 'Email already registered', 409);
      }

      // Hash password with appropriate cost factor
      const hashedPassword = await bcrypt.hash(userData.password, this.SALT_ROUNDS);

      // Create user with explicit role casting and proper typing
      const newUser = await UserModel.create({
        ...userData,
        password: hashedPassword,
        roles: (userData.roles ?? [Role.USER]) as Role[],
        isActive: true,
      });

      // Sync permissions after creation
      await newUser.syncPermissions();
      await newUser.save();

      // Generate initial tokens with proper typing
      const tokens = await this.generateAuthTokens(newUser, {
        ipAddress: 'registration',
        userAgent: 'registration',
      });

      return {
        ...tokens,
        user: this.formatUserResponse(newUser),
        expiresIn: 900,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Registration error:', error);
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Registration failed', 500);
    }
  }

  /**
   * Refresh authentication token
   * @throws {AppError} If refresh token is invalid or expired
   */
  public async refreshToken(refreshToken: string): Promise<ILoginResponse> {
    try {
      // Verify refresh token
      const decoded = await jwtService.verifyToken(refreshToken, true);

      // Check if token is blacklisted
      const isBlacklisted = await Redis.get(`blacklist:${refreshToken}`);
      if (isBlacklisted) {
        throw new AppError(ErrorCode.TOKEN_INVALID, 'Token has been revoked', 401);
      }

      // Get user
      const user = await UserModel.findById(new Types.ObjectId(decoded.userId));
      if (!user || !user.isActive) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'User not found or inactive', 401);
      }

      // Generate new tokens
      const tokens = await this.generateAuthTokens(user, {
        ipAddress: decoded.ip || 'unknown',
        userAgent: decoded.userAgent || 'unknown',
      });

      // Blacklist used refresh token
      await Redis.setEx(`blacklist:${refreshToken}`, 7 * 24 * 60 * 60, '1'); // 7 days

      return {
        ...tokens,
        user: this.formatUserResponse(user),
        expiresIn: 900,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error('Token refresh error:', error);
      throw new AppError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token', 401);
    }
  }

  /**
   * Logout user and invalidate tokens
   * @throws {AppError} If logout fails
   */
  public async logout(
    userId: string,
    refreshToken: string,
    allDevices: boolean = false,
  ): Promise<void> {
    try {
      if (allDevices) {
        // Invalidate all user tokens
        await jwtService.invalidateAllUserTokens(userId);
        await this.removeAllUserSessions(userId);
      } else {
        // Invalidate single token
        await jwtService.revokeToken(refreshToken);
        await this.removeUserSession(userId, refreshToken);
      }

      await this.logAuthEvent({ _id: userId }, 'logout', 'success', {
        allDevices,
      });
    } catch (error) {
      logger.error('Logout error:', error);
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 'Logout failed', 500);
    }
  }

  /**
   * Helper Methods
   */

  private async generateAuthTokens(
    user: IUserDocument | AuthUser,
    authInfo: {
      ipAddress: string;
      userAgent: string;
      deviceInfo?: Partial<DeviceInfo>;
    },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenPayload: ITokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };

    return await jwtService.generateTokens(tokenPayload, {
      ipAddress: authInfo.ipAddress,
      userAgent: authInfo.userAgent,
      deviceId: authInfo.deviceInfo?.deviceId,
    });
  }

  private async createUserSession(
    userId: string,
    sessionInfo: {
      deviceInfo?: Partial<DeviceInfo>;
      ipAddress: string;
      userAgent: string;
    },
  ): Promise<void> {
    const sessionKey = `${this.SESSION_PREFIX}${userId}`;
    const session = {
      deviceInfo: sessionInfo.deviceInfo,
      ipAddress: sessionInfo.ipAddress,
      userAgent: sessionInfo.userAgent,
      createdAt: new Date(),
      lastActive: new Date(),
    };

    await Redis.setEx(sessionKey, 24 * 60 * 60, JSON.stringify(session));
  }

  private async removeUserSession(userId: string, token: string): Promise<void> {
    await Redis.del(`${this.SESSION_PREFIX}${userId}:${token}`);
  }

  private async removeAllUserSessions(userId: string): Promise<void> {
    const sessionPattern = `${this.SESSION_PREFIX}${userId}:*`;
    const keys = await Redis.keys(sessionPattern);
    if (keys.length > 0) {
      await Redis.deleteMany(keys);
    }
  }

  private async isUserBlocked(userId: string): Promise<boolean> {
    const attemptsKey = `${this.ATTEMPTS_PREFIX}${userId}`;
    const loginAttempts = await Redis.get(attemptsKey);
    return loginAttempts ? parseInt(loginAttempts, 10) >= this.MAX_LOGIN_ATTEMPTS : false;
  }

  private async handleFailedLoginAttempt(userId: string): Promise<void> {
    const attemptsKey = `${this.ATTEMPTS_PREFIX}${userId}`;
    const currentAttempts = await Redis.get(attemptsKey);
    const attempts = currentAttempts ? parseInt(currentAttempts, 10) + 1 : 1;

    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      await Redis.setEx(`${this.BLOCK_PREFIX}${userId}`, this.BLOCK_DURATION, '1');
      await Redis.del(attemptsKey);

      logger.warn('Account locked due to too many failed attempts:', { userId });
    } else {
      await Redis.setEx(attemptsKey, this.BLOCK_DURATION, attempts.toString());
    }
  }

  private async resetLoginAttempts(userId: string): Promise<void> {
    await Redis.del(`${this.ATTEMPTS_PREFIX}${userId}`);
  }

  private async logAuthEvent(
    user: { _id: string | unknown; email?: string },
    action: string,
    status: 'success' | 'failure',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const userId = typeof user._id === 'string' && user._id !== 'unknown' ? user._id : 'system';

      await auditService.log({
        userId,
        action: `user.${action}`,
        category: 'auth',
        details: {
          email: user.email,
          ...details,
        },
        ipAddress: (details.ipAddress as string) || 'unknown',
        userAgent: (details.userAgent as string) || 'unknown',
        status,
      });
    } catch (error) {
      logger.error('Failed to log auth event:', error);
    }
  }
}

export const authService = new AuthService();
