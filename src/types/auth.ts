// src/types/auth.ts
import type { Request } from 'express';
import type { Document, Types } from 'mongoose';
import type { WithTimestamps } from './mongoose.js';
import type { ParsedQs } from 'qs';

// Define base parameter dictionary type
export type RequestParams = Record<string, string>;

/**
 * Enums
 */
export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  VERIFIED = 'verified',
}

export enum CustomFieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  BOOLEAN = 'boolean',
  LIST = 'list',
}

/**
 * Type-safe base request parameters
 */
export interface BaseRequestParams {
  [key: string]: string | undefined;
}

/**
 * Custom field definitions
 */
export interface CustomField {
  name: string;
  type: CustomFieldType;
  required?: boolean;
  listOptions?: string[];
  defaultValue?: unknown;
  description?: string;
}

/**
 * Base user interface with essential user information
 */
export interface IUser extends WithTimestamps {
  _id: Types.ObjectId; // Add explicit _id typing
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLogin?: Date;
  roles: Role[];
  permissions: string[];
  tokenVersion?: number;
  passwordChangedAt?: Date;
  loginAttempts?: number;
  lockUntil?: Date;
}

/**
 * Allowed user roles enum for type safety
 */
export enum Role {
  ADMIN = 'admin',
  STAFF = 'staff',
  USER = 'user',
}
/**
 * Permission interface with strict action types
 */
export interface IPermission {
  name: string;
  description: string;
  resource: string;
  action: PermissionAction;
  conditions?: Record<string, unknown>; // Optional conditions for fine-grained access control
}

/**
 * Strict permission actions enum
 */
export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  MANAGE = 'manage',
}

/**
 * Customer group base interface
 */
export interface ICustomerGroup extends WithTimestamps {
  name: string;
  description?: string;
  customFields: CustomField[];
  customers: Types.ObjectId[];
  metadata?: Record<string, unknown>;
}

/**
 * Customer group document interface for Mongoose
 */
export interface ICustomerGroupDocument extends ICustomerGroup, Document {
  _id: Types.ObjectId;
}

/**
 * Request body for creating/updating a customer group
 */
export interface CustomerGroupRequest {
  name: string;
  description?: string;
  customFields?: CustomField[];
  customers?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Request body for updating custom fields
 */
export interface UpdateCustomFieldsRequest {
  customFields: CustomField[];
}

/**
 * Response interface for customer group operations
 */
export interface CustomerGroupResponse {
  _id: string;
  name: string;
  description?: string;
  customFields: CustomField[];
  customers: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role interface with enhanced type safety
 */
export interface IRole {
  name: Role;
  description: string;
  permissions: string[];
  isSystem?: boolean; // To protect system-defined roles
}

/**
 * Mongoose document interfaces with proper type inheritance
 */
export interface IUserDocument extends Omit<IUser, '_id'>, Document {
  _id: Types.ObjectId;
  comparePassword(candidatePassword: string): Promise<boolean>;
  syncPermissions(): Promise<void>;
  incrementLoginAttempts(): Promise<void>;
  resetLoginAttempts(): Promise<void>;
  isLocked(): boolean;
}

export interface IPermissionDocument extends IPermission, Document {}

export interface IRoleDocument extends IRole, Document {}

/**
 * Authentication user information for tokens
 */
export interface AuthUser {
  _id: string;
  userId: string;
  email: string;
  roles: Role[];
  permissions: string[];
  tokenVersion?: number;
}

/**
 * Request/Response types with strict validation
 */
export interface LoginRequestBody {
  email: string;
  password: string;
  deviceInfo?: DeviceInfo; // For multi-device support
}

export interface RegisterRequestBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roles?: Role[]; // Only allowed for admin users
}

export interface ILoginResponse {
  accessToken: string;
  refreshToken: string;
  user: IUserResponse;
  expiresIn: number;
}

export interface RegisterRequest extends AuthenticatedRequest {
  body: RegisterRequestBody & {
    deviceInfo?: Partial<DeviceInfo>;
  };
}

export interface LoginRequest extends AuthenticatedRequest {
  body: LoginRequestBody & {
    deviceInfo?: Partial<DeviceInfo>;
  };
}

export interface RefreshTokenRequest extends AuthenticatedRequest {
  body: RefreshTokenRequestBody & {
    deviceInfo?: Partial<DeviceInfo>;
  };
}

export interface LogoutRequest extends AuthenticatedRequest {
  body: LogoutRequestBody;
}

export interface DecodedToken {
  userId: string;
  email: string;
  roles: unknown; // Will be validated to Role[]
  permissions: string[];
  tokenVersion?: number;
}

export interface IUserResponse {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: string[];
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Enhanced Express Request with authenticated user
 *
 * @template P - URL Parameters type, defaults to empty object
 * @template ResB - Response Body type, defaults to unknown
 * @template ReqB - Request Body type, defaults to unknown
 * @template Q - Query Parameters type, defaults to ParsedQs
 */
export interface AuthenticatedRequest<
  P extends BaseRequestParams = BaseRequestParams,
  ResB = unknown,
  ReqB = unknown,
  Q extends ParsedQs = ParsedQs,
> extends Request<P, ResB, ReqB, Q> {
  user?: AuthUser;
}
/**
 * Type helper for controller requests with proper typing
 *
 * @template B - Request Body type
 * @template P - URL Parameters type
 * @template Q - Query Parameters type
 */
export type TypedAuthRequest<
  B extends Record<string, unknown> = Record<string, unknown>,
  P extends BaseRequestParams = BaseRequestParams,
  Q extends ParsedQs = ParsedQs,
> = Omit<AuthenticatedRequest, 'body' | 'query' | 'params'> & {
  body: B;
  params: P;
  query: Q;
  user?: AuthUser;
};

/**
 * Device information for token tracking and security
 */
export interface DeviceInfo {
  deviceId: string;
  deviceType: string;
  deviceName?: string;
  platform?: string;
  browserName?: string;
  browserVersion?: string;
  ipAddress?: string;
  location?: string;
}

/**
 * Token-related interfaces
 */
export interface ITokenPayload {
  userId: string;
  email: string;
  roles: Role[];
  permissions: string[];
  tokenVersion?: number;
  deviceId?: string;
}

export interface RefreshTokenRequestBody {
  refreshToken: string;
  deviceInfo?: DeviceInfo;
}

export interface LogoutRequestBody {
  refreshToken: string;
  allDevices?: boolean; // Option to logout from all devices
}

/**
 * Session data interface
 */
export interface SessionData {
  id: string;
  userId: string;
  deviceInfo: DeviceInfo;
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
}

/**
 * Authentication options for fine-tuned control
 */
export interface AuthOptions {
  expiresIn?: string | number;
  refreshExpiresIn?: string | number;
  issuer?: string;
  audience?: string;
  clockTolerance?: number;
  maxLoginAttempts?: number;
  lockoutDuration?: number;
  requireEmailVerification?: boolean;
}

/**
 * Permission check options
 */
export interface PermissionCheckOptions {
  requireAll?: boolean;
  resourceId?: string;
  conditions?: Record<string, unknown>;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
  statusCode?: number;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}
