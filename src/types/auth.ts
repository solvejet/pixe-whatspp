// src/types/auth.ts
import type { Document, Types } from 'mongoose';
import type { Request } from 'express';
import type { ParsedQs } from 'qs';

// Base Permission Types
export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage';
export type PermissionResource =
  | 'users'
  | 'roles'
  | 'permissions'
  | 'customers'
  | 'audit_logs'
  | 'system'
  | 'settings';

// Permission interfaces
export interface IPermission extends Document {
  name: string;
  description: string;
  resource: PermissionResource;
  action: PermissionAction;
  createdAt: Date;
  updatedAt: Date;
}

// Role interface
export interface IRole extends Document {
  name: string;
  description: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Base interface for user data
export interface IUserData {
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLogin?: Date;
  roles: string[];
  permissions: string[];
}

// Token payload interface
export interface ITokenPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  iat?: number;
  exp?: number;
}

// Request types
export type RequestParams = Record<string, string>;
export type RequestQuery = ParsedQs;
export type RequestBody = Record<string, unknown>;

// Extend Express Request type to include user
export interface AuthenticatedRequest extends Request {
  user?: ITokenPayload;
  params: RequestParams;
  query: RequestQuery;
  body: RequestBody;
}

// User document interface for MongoDB
export interface IUserDocument extends IUserData, Document {
  _id: Types.ObjectId;
  password: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  syncPermissions(): Promise<void>;
}

// Response interfaces
export interface IUserResponse extends IUserData {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILoginResponse {
  accessToken: string;
  refreshToken: string;
  user: IUserResponse;
}

// Request interfaces
export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roles?: string[];
}

// Base request types
export interface BaseRequestBody extends Record<string, unknown> {
  [key: string]: unknown;
}

export interface BaseParams extends Record<string, string> {
  [key: string]: string;
}

// Type helper for authenticated controller requests
export type TypedAuthRequest<
  TBody extends BaseRequestBody = BaseRequestBody,
  TParams extends BaseParams = BaseParams,
  TQuery extends RequestQuery = RequestQuery,
> = AuthenticatedRequest & {
  body: TBody;
  params: TParams;
  query: TQuery;
};

// Specific request types
export interface LoginRequestBody extends BaseRequestBody {
  email: string;
  password: string;
}

export interface RegisterRequestBody extends BaseRequestBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roles?: string[];
}

export interface RefreshTokenRequestBody extends BaseRequestBody {
  refreshToken: string;
}

export interface LogoutRequestBody extends BaseRequestBody {
  refreshToken: string;
}

// Auth Service Error types
export interface AuthError extends Error {
  statusCode: number;
  isOperational: boolean;
}

// Rate limiting types
export interface RateLimitInfo {
  windowMs: number;
  max: number;
  remaining: number;
  resetTime: Date;
}

// Session types
export interface SessionData {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  createdAt: Date;
  lastActive: Date;
}

// Auth service configuration
export interface AuthConfig {
  jwtSecret: string;
  jwtRefreshSecret: string;
  jwtExpiresIn: string;
  jwtRefreshExpiresIn: string;
  maxLoginAttempts: number;
  lockoutDuration: number;
}

// Role-based access control types
export interface IRoleAssignment {
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  assignedAt: Date;
}

export interface IPermissionAssignment {
  roleId: Types.ObjectId;
  permissionId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  assignedAt: Date;
}
