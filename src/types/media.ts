// src/types/media.ts
import type { Types } from 'mongoose';
import type { WithTimestamps } from './mongoose.js';
import { MediaStatus, MediaType } from '@/models/media.model.js';

/**
 * Custom Multer file interface that matches the structure of uploaded files
 * without stream property requirement
 */
export interface MulterFile {
  /** Field name specified in the form */
  fieldname: string;
  /** Name of the file on the user's computer */
  originalname: string;
  /** Encoding type of the file */
  encoding: string;
  /** Mime type of the file */
  mimetype: string;
  /** Size of the file in bytes */
  size: number;
  /** The folder to which the file has been saved (DiskStorage) */
  destination?: string;
  /** The name of the file within the destination (DiskStorage) */
  filename?: string;
  /** Location of the uploaded file (DiskStorage) */
  path?: string;
  /** A Buffer of the entire file (MemoryStorage) */
  buffer?: Buffer;
}

// Define request types
export interface FileUploadRequest extends Omit<Express.Request, 'file'> {
  file?: MulterFile;
}

export interface FilesUploadRequest extends Omit<Express.Request, 'files'> {
  files?: { [fieldname: string]: MulterFile[] };
}

/**
 * Response structure for media upload
 */
export interface MediaUploadResponse {
  id: string;
  originalName: string;
  status: MediaStatus;
  type: MediaType;
  url?: string;
}

/**
 * Response structure for bulk upload operations
 */
export interface BulkUploadResponse {
  successful: MediaUploadResponse[];
  failed: Array<{
    originalName: string;
    error: string;
  }>;
}

/**
 * Response structure for media requests
 */
export interface IMediaResponse extends WithTimestamps {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: MediaType;
  url?: string;
  status: MediaStatus;
  uploadedBy: string;
  error?: string;
}

/**
 * WhatsApp Media API response structure
 */
export interface WhatsAppMediaUploadResponse {
  messaging_product: string;
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
  id: string;
}

/**
 * Background job structure for media uploads
 */
export interface MediaUploadJob {
  mediaId: Types.ObjectId;
  filePath: string;
  mimeType: string;
}

/**
 * WhatsApp configuration interface
 */
export interface WhatsAppMediaConfig {
  phoneNumberId: string;
  accessToken: string;
  maxFileSize: number;
  allowedTypes: string[];
}

/**
 * Media service configuration interface
 */
export interface MediaServiceConfig {
  uploadPath: string;
  maxFileSize: number;
  allowedTypes: string[];
  whatsapp: WhatsAppMediaConfig;
}

/**
 * Parameters for listing media files
 */
export interface ListMediaParams {
  userId: string;
  page?: number;
  limit?: number;
  type?: MediaType;
  status?: MediaStatus;
}

/**
 * Media file validation options
 */
export interface MediaValidationOptions {
  skipSizeCheck?: boolean;
}

/**
 * Constraints for different media types
 */
export interface MediaTypeConstraints {
  maxSize: number;
  allowedTypes: string[];
  allowedExtensions?: string[];
}

/**
 * Upload result with success/failure tracking
 */
export interface MediaUploadResult {
  success: boolean;
  mediaId?: string;
  error?: string;
  url?: string;
}

/**
 * Media deletion response
 */
export interface MediaDeletionResponse {
  success: boolean;
  message: string;
  errors?: string[];
}

/**
 * Media statistics response
 */
export interface MediaStatistics {
  totalCount: number;
  byType: Record<MediaType, number>;
  byStatus: Record<MediaStatus, number>;
  totalSize: number;
  averageSize: number;
  uploadedToday: number;
  uploadedThisMonth: number;
}

/**
 * Query parameters for media search
 */
export interface MediaSearchQuery {
  userId?: string;
  type?: MediaType;
  status?: MediaStatus;
  startDate?: Date;
  endDate?: Date;
  minSize?: number;
  maxSize?: number;
  filename?: string;
}

/**
 * Media processing options
 */
export interface MediaProcessingOptions {
  compress?: boolean;
  resize?: {
    width?: number;
    height?: number;
    maintainAspectRatio?: boolean;
  };
  convert?: {
    format: string;
    quality?: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Webhook payload for media status updates
 */
export interface MediaStatusWebhook {
  mediaId: string;
  status: MediaStatus;
  timestamp: Date;
  details?: {
    error?: string;
    progress?: number;
    stage?: string;
  };
}

/**
 * Cache configuration for media service
 */
export interface MediaCacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize: number;
  prefix: string;
}

/**
 * Rate limiting configuration for media uploads
 */
export interface MediaRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  perUser: boolean;
  blockDuration: number;
}

/**
 * Media access control configuration
 */
export interface MediaACLConfig {
  publicAccess: boolean;
  allowedRoles: string[];
  allowedUsers: string[];
  expirationTime?: number;
}

/**
 * Media stream configuration
 */
export interface MediaStreamConfig {
  chunkSize: number;
  maxConcurrentStreams: number;
  timeout: number;
  retryOptions: {
    attempts: number;
    delay: number;
    backoff: number;
  };
}
