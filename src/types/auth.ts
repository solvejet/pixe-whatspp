// src/types/auth.ts
import type { Document, Types } from 'mongoose';
import type { Request } from 'express';
import type { ParsedQs } from 'qs';

// Permission interfaces
export interface IPermission extends Document {
  name: string;
  description: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'manage';
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

export interface ITokenPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

// Define request/response base types
export type RequestParams = Record<string, string>;
export type RequestQuery = ParsedQs;

// Extend Express Request type to include user
export interface AuthenticatedRequest<
  TParams = RequestParams,
  ResBody = unknown,
  ReqBody = unknown,
  TQuery = RequestQuery,
> extends Request<TParams, ResBody, ReqBody, TQuery> {
  user?: ITokenPayload;
}

// Interface for user document in MongoDB
export interface IUserDocument extends IUserData, Document {
  _id: Types.ObjectId;
  password: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// Interface for API responses
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

export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roles?: string[];
}
