import type { AuthenticatedRequest } from '@/types/auth.js';
import type { MulterFile } from './media.js';
import type { Request } from 'express';
import type { ParsedQs } from 'qs';
import type { MediaStatus, MediaType } from '@/models/media.model.js';

export type RequestParams = Record<string, string>;

export interface MediaRequestParams extends RequestParams {
  id: string;
}

export interface ListMediaQuery extends ParsedQs {
  page?: string;
  limit?: string;
  type?: MediaType;
  status?: MediaStatus;
}

export interface AuthFileRequest extends Omit<Request, 'file' | 'files'> {
  user?: AuthenticatedRequest['user'];
}

export interface MediaUploadRequest extends AuthFileRequest {
  file?: MulterFile;
  params: MediaRequestParams;
  query: ListMediaQuery;
  body: Record<string, unknown>;
}

export interface ValidatedMediaUploadRequest extends Omit<MediaUploadRequest, 'file' | 'user'> {
  file: MulterFile;
  user: NonNullable<AuthenticatedRequest['user']>;
}

export interface MediaBulkUploadRequest extends AuthFileRequest {
  files?: MulterFile[];
  params: MediaRequestParams;
  query: ListMediaQuery;
  body: Record<string, unknown>;
}

export interface ValidatedMediaBulkUploadRequest
  extends Omit<MediaBulkUploadRequest, 'files' | 'user'> {
  files: MulterFile[];
  user: NonNullable<AuthenticatedRequest['user']>;
}

/**
 * Type guard to verify if a single file exists and is valid
 */
export function hasFile(req: MediaUploadRequest): req is ValidatedMediaUploadRequest {
  return (
    req.file !== undefined &&
    req.file !== null &&
    typeof req.file.originalname === 'string' &&
    typeof req.file.mimetype === 'string' &&
    typeof req.file.size === 'number' &&
    req.file.size > 0 &&
    hasValidUser(req)
  );
}

/**
 * Type guard to verify if files array exists and is valid
 */
export function hasFiles(req: MediaBulkUploadRequest): req is ValidatedMediaBulkUploadRequest {
  return (
    Array.isArray(req.files) &&
    req.files.length > 0 &&
    req.files.every(
      (file) =>
        file !== null &&
        typeof file.originalname === 'string' &&
        typeof file.mimetype === 'string' &&
        typeof file.size === 'number' &&
        file.size > 0,
    ) &&
    hasValidUser(req)
  );
}

/**
 * Type guard to check if the request contains valid user information
 */
export function hasValidUser(
  req: AuthFileRequest,
): req is AuthFileRequest & { user: NonNullable<AuthenticatedRequest['user']> } {
  return req.user !== undefined && req.user !== null && typeof req.user.userId === 'string';
}

/**
 * Type guard to check if request has valid ID parameter
 */
export function hasValidId(
  req: AuthFileRequest & { params: MediaRequestParams },
): req is AuthFileRequest & { params: { id: string } } {
  return req.params !== undefined && typeof req.params.id === 'string' && req.params.id.length > 0;
}
