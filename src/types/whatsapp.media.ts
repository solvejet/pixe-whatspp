// src/types/whatsapp.media.ts

import type { Types } from 'mongoose';

/**
 * Media types supported by WhatsApp API
 */
export enum WhatsAppMediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
}

/**
 * WhatsApp API media response
 */
export interface WhatsAppMediaResponse {
  messaging_product: string;
  url?: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

/**
 * Base interface for media documents
 */
export interface IWhatsAppMedia {
  whatsappMediaId: string;
  type: WhatsAppMediaType;
  mimeType: string;
  filePath: string;
  fileSize: number;
  sha256: string;
  metadata?: Record<string, unknown>;
  uploadedBy: Types.ObjectId;
  status: 'active' | 'deleted';
}

/**
 * Queue message types for media operations
 */
export enum MediaQueueMessageType {
  UPLOAD = 'upload',
  DELETE = 'delete',
  CLEANUP = 'cleanup',
}

export interface MediaQueueMessage {
  type: MediaQueueMessageType;
  data: Record<string, unknown>;
  timestamp: number;
  retryCount?: number;
}

/**
 * Interface for queued upload data
 */
export interface QueuedUploadData {
  file: Buffer;
  type: WhatsAppMediaType;
  mimeType: string;
  uploadedBy: string;
  metadata?: Record<string, unknown>;
  retryCount?: number;
}

/**
 * Interface for queued delete data
 */
export interface QueuedDeleteData {
  mediaId: string;
  permanent?: boolean;
  retryCount?: number;
}

/**
 * Interface for queued cleanup data
 */
export interface QueuedCleanupData {
  olderThan?: number;
  syncWithWhatsApp?: boolean;
  batchSize?: number;
}
