// src/services/auth.service.ts
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { UserModel } from '@/models/user.model.js';
import { RoleModel } from '@/models/role.model.js';
import { ApiError } from '@/middleware/error-handler.js';
import type {
  IUserDocument,
  IUserResponse,
  ITokenPayload,
  ILoginResponse,
  IRegisterRequest,
} from '@/types/auth.js';
import { Redis } from '@/config/redis.js';

export class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
  private readonly JWT_EXPIRES_IN = '15m';
  private readonly JWT_REFRESH_EXPIRES_IN = '7d';
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCK_TIME = 15 * 60; // 15 minutes in seconds

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

  async login(email: string, password: string): Promise<ILoginResponse> {
    const user = await UserModel.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Handle login attempts
    const lockKey = `lockout:${user._id.toString()}`;
    const attempts = (await Redis.get(`attempts:${user._id.toString()}`)) || '0';
    const isLocked = await Redis.get(lockKey);

    if (isLocked) {
      throw new ApiError(423, 'Account is temporarily locked. Please try again later.');
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      const currentAttempts = parseInt(attempts) + 1;

      if (currentAttempts >= this.MAX_LOGIN_ATTEMPTS) {
        await Redis.set(lockKey, '1', this.LOCK_TIME);
        await Redis.del(`attempts:${user._id.toString()}`);
        throw new ApiError(423, 'Account locked. Please try again after 15 minutes.');
      }

      await Redis.set(`attempts:${user._id.toString()}`, currentAttempts.toString(), 300);
      throw new ApiError(
        401,
        `Invalid credentials. ${this.MAX_LOGIN_ATTEMPTS - currentAttempts} attempts remaining.`,
      );
    }

    await Redis.del(`attempts:${user._id.toString()}`);

    user.lastLogin = new Date();
    await user.save();

    const tokens = await this.generateTokens(user);
    return {
      ...tokens,
      user: this.formatUserResponse(user),
    };
  }

  async register(userData: IRegisterRequest, currentUser?: ITokenPayload): Promise<ILoginResponse> {
    if (userData.roles?.some((role) => ['admin', 'staff'].includes(role))) {
      if (!currentUser || !currentUser.roles.includes('admin')) {
        throw new ApiError(403, 'Only administrators can create admin or staff accounts');
      }
    }

    const existingUser = await UserModel.findOne({ email: userData.email });
    if (existingUser) {
      throw new ApiError(409, 'Email already registered');
    }

    const newUser = await UserModel.create({
      ...userData,
      roles: userData.roles || ['user'],
      permissions: [],
    });

    const tokens = await this.generateTokens(newUser);
    return {
      ...tokens,
      user: this.formatUserResponse(newUser),
    };
  }

  async refreshToken(refreshToken: string): Promise<ILoginResponse> {
    try {
      const payload = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET) as ITokenPayload;

      const isBlacklisted = await Redis.get(`blacklist:${refreshToken}`);
      if (isBlacklisted) {
        throw new ApiError(401, 'Token has been revoked');
      }

      const user = await UserModel.findById(new Types.ObjectId(payload.userId));
      if (!user || !user.isActive) {
        throw new ApiError(401, 'User not found or inactive');
      }

      const tokens = await this.generateTokens(user);
      await Redis.set(`blacklist:${refreshToken}`, '1', 7 * 24 * 60 * 60);

      return {
        ...tokens,
        user: this.formatUserResponse(user),
      };
    } catch {
      // Removed the unused error parameter completely
      throw new ApiError(401, 'Invalid refresh token');
    }
  }

  async logout(refreshToken: string): Promise<void> {
    await Redis.set(`blacklist:${refreshToken}`, '1', 7 * 24 * 60 * 60);
  }

  private async generateTokens(
    user: IUserDocument,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const roles = await RoleModel.find({ _id: { $in: user.roles } });
    const permissions = roles.flatMap((role) => role.permissions);

    const tokenPayload: ITokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles,
      permissions,
    };

    return {
      accessToken: this.generateAccessToken(tokenPayload),
      refreshToken: this.generateRefreshToken(tokenPayload),
    };
  }

  private generateAccessToken(payload: ITokenPayload): string {
    return jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    });
  }

  private generateRefreshToken(payload: ITokenPayload): string {
    return jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: this.JWT_REFRESH_EXPIRES_IN,
    });
  }
}
