// src/services/whatsapp-media.service.ts

import { Types } from 'mongoose';
import crypto from 'crypto';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { WhatsAppMediaModel } from '@/models/whatsapp-media.model.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';
import {
  MediaQueueMessageType,
  WhatsAppMediaType,
  type MediaQueueMessage,
  type QueuedCleanupData,
  type QueuedDeleteData,
  type QueuedUploadData,
  type WhatsAppMediaResponse,
} from '@/types/whatsapp.media.js';

interface UploadMediaParams {
  file: Buffer;
  type: WhatsAppMediaType;
  mimeType: string;
  uploadedBy: Types.ObjectId;
  metadata?: Record<string, unknown>;
}

interface BulkUploadResult {
  successes: Array<{ mediaId: string; whatsappMediaId: string }>;
  failures: Array<{ mediaId: string; error: string }>;
}

export class WhatsAppMediaService {
  private static instance: WhatsAppMediaService;
  private readonly CHUNK_SIZE = 5; // Number of files to process in parallel
  private readonly QUEUE_NAME = 'whatsapp_media_queue';
  private readonly API_BASE_URL = 'https://graph.facebook.com/v21.0';
  private readonly UPLOAD_RETRY_ATTEMPTS = 3;

  private constructor() {}

  public static getInstance(): WhatsAppMediaService {
    if (!WhatsAppMediaService.instance) {
      WhatsAppMediaService.instance = new WhatsAppMediaService();
    }
    return WhatsAppMediaService.instance;
  }

  /**
   * Upload single media file to WhatsApp
   */
  public async uploadMedia(params: UploadMediaParams): Promise<string> {
    try {
      // Calculate SHA256 hash of file
      const sha256 = crypto.createHash('sha256').update(params.file).digest('hex');

      // Check if file already exists
      const existingMedia = await WhatsAppMediaModel.findOne({
        sha256,
        status: 'active',
        type: params.type,
      });

      if (existingMedia) {
        return existingMedia.whatsappMediaId;
      }

      // Upload to WhatsApp
      const formData = new FormData();
      formData.append('file', new Blob([params.file]), 'media');
      formData.append('type', params.mimeType);
      formData.append('messaging_product', 'whatsapp');

      const response = await fetch(`${this.API_BASE_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to upload media to WhatsApp',
          response.status,
        );
      }

      const result = (await response.json()) as { id: string };

      // Save media details to database
      const media = await WhatsAppMediaModel.create({
        whatsappMediaId: result.id,
        type: params.type,
        mimeType: params.mimeType,
        filePath: `whatsapp_media/${sha256}`,
        fileSize: params.file.length,
        sha256,
        metadata: params.metadata,
        uploadedBy: params.uploadedBy,
      });

      return media.whatsappMediaId;
    } catch (error) {
      logger.error('Media upload error:', error);
      throw error;
    }
  }

  /**
   * Upload multiple media files in chunks
   */
  public async bulkUpload(
    files: Array<{
      mediaId: string;
      file: Buffer;
      type: WhatsAppMediaType;
      mimeType: string;
      metadata?: Record<string, unknown>;
    }>,
    uploadedBy: Types.ObjectId,
  ): Promise<BulkUploadResult> {
    const result: BulkUploadResult = {
      successes: [],
      failures: [],
    };

    // Process files in chunks
    for (let i = 0; i < files.length; i += this.CHUNK_SIZE) {
      const chunk = files.slice(i, i + this.CHUNK_SIZE);
      const uploadPromises = chunk.map((file) => this.uploadWithRetry(file, uploadedBy));

      const chunkResults = await Promise.allSettled(uploadPromises);

      chunkResults.forEach((chunkResult, index) => {
        const file = chunk[index]; // chunk[index] is now guaranteed to exist because of the forEach loop
        if (!file) {
          logger.error('Unexpected undefined file in chunk during bulk upload');
          return;
        }

        if (chunkResult.status === 'fulfilled') {
          result.successes.push({
            mediaId: file.mediaId,
            whatsappMediaId: chunkResult.value,
          });
        } else {
          result.failures.push({
            mediaId: file.mediaId,
            error: chunkResult.reason.message,
          });
        }
      });
    }

    return result;
  }

  /**
   * Upload with retry mechanism
   */
  private async uploadWithRetry(
    file: {
      mediaId: string;
      file: Buffer;
      type: WhatsAppMediaType;
      mimeType: string;
      metadata?: Record<string, unknown>;
    },
    uploadedBy: Types.ObjectId,
  ): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.UPLOAD_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.uploadMedia({
          file: file.file,
          type: file.type,
          mimeType: file.mimeType,
          uploadedBy,
          metadata: file.metadata,
        });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    throw lastError;
  }

  /**
   * Get media URL from WhatsApp
   */
  public async getMediaUrl(whatsappMediaId: string): Promise<string> {
    try {
      const response = await fetch(`${this.API_BASE_URL}/${whatsappMediaId}`, {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to get media URL from WhatsApp',
          response.status,
        );
      }

      const result = (await response.json()) as WhatsAppMediaResponse;
      return result.url ?? '';
    } catch (error) {
      logger.error('Get media URL error:', error);
      throw error;
    }
  }

  /**
   * Download media file from WhatsApp
   */
  public async downloadMedia(whatsappMediaId: string): Promise<Buffer> {
    try {
      const url = await this.getMediaUrl(whatsappMediaId);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to download media from WhatsApp',
          response.status,
        );
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error('Media download error:', error);
      throw error;
    }
  }

  /**
   * Delete media from WhatsApp and mark as deleted in database
   */
  public async deleteMedia(whatsappMediaId: string): Promise<void> {
    try {
      const response = await fetch(`${this.API_BASE_URL}/${whatsappMediaId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to delete media from WhatsApp',
          response.status,
        );
      }

      await WhatsAppMediaModel.updateOne({ whatsappMediaId }, { status: 'deleted' });
    } catch (error) {
      logger.error('Media deletion error:', error);
      throw error;
    }
  }

  /**
   * Initialize media queue consumer
   */
  public async initializeQueue(): Promise<void> {
    try {
      const channel = await RabbitMQ.createChannel('whatsapp_media');
      await RabbitMQ.assertQueue(channel, this.QUEUE_NAME, {
        durable: true,
        maxPriority: 10,
      });

      await channel.consume(
        this.QUEUE_NAME,
        async (msg) => {
          if (!msg) return;

          try {
            const data = JSON.parse(msg.content.toString());
            await this.processQueueMessage(data);
            channel.ack(msg);
          } catch (error) {
            logger.error('Error processing media queue message:', error);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );
    } catch (error) {
      logger.error('Error initializing media queue:', error);
      throw error;
    }
  }

  /**
   * Process queue message implementation
   */
  private async processQueueMessage(data: unknown): Promise<void> {
    if (!this.isValidQueueMessage(data)) {
      throw new Error('Invalid queue message format');
    }

    const message = data as MediaQueueMessage;

    switch (message.type) {
      case MediaQueueMessageType.UPLOAD:
        await this.handleQueuedUpload(message.data);
        break;
      case MediaQueueMessageType.DELETE:
        await this.handleQueuedDelete(message.data);
        break;
      case MediaQueueMessageType.CLEANUP:
        await this.handleQueuedCleanup(message.data);
        break;
      default:
        logger.warn('Unknown media queue message type:', message.type);
    }
  }

  private isValidQueueMessage(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Partial<MediaQueueMessage>;
    return (
      typeof msg.type === 'string' &&
      typeof msg.data === 'object' &&
      typeof msg.timestamp === 'number'
    );
  }

  /**
   * Handle queued media upload operation
   * Processes upload requests from the queue with retry mechanism
   */
  private async handleQueuedUpload(data: Record<string, unknown>): Promise<void> {
    try {
      // Validate and parse upload data
      if (!this.validateUploadData(data)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid upload data format', 400, true, {
          details: data,
        });
      }

      const {
        file,
        type,
        mimeType,
        uploadedBy,
        metadata,
        retryCount = 0,
      } = data as QueuedUploadData;

      // Add operation info to logger context
      logger.info('Processing queued upload', {
        type,
        mimeType,
        retryCount,
        uploadedBy,
      });

      try {
        // Attempt media upload
        await this.uploadMedia({
          file: Buffer.from(file),
          type,
          mimeType,
          uploadedBy: new Types.ObjectId(uploadedBy),
          metadata,
        });

        logger.info('Successfully processed queued upload', {
          type,
          uploadedBy,
        });
      } catch (error) {
        // Handle retries for failed uploads
        if (retryCount < this.UPLOAD_RETRY_ATTEMPTS) {
          logger.warn(
            `Upload failed, scheduling retry (${retryCount + 1}/${this.UPLOAD_RETRY_ATTEMPTS})`,
            {
              type,
              error,
            },
          );

          // Calculate exponential backoff delay
          const backoffDelay = Math.min(
            Math.pow(2, retryCount) * 1000,
            30000, // Max 30 seconds
          );

          // Re-queue with incremented retry count after backoff
          setTimeout(async () => {
            const channel = await RabbitMQ.createChannel('whatsapp_media_retry');
            await channel.publish(
              '',
              this.QUEUE_NAME,
              Buffer.from(
                JSON.stringify({
                  type: MediaQueueMessageType.UPLOAD,
                  data: {
                    ...data,
                    retryCount: retryCount + 1,
                  },
                  timestamp: Date.now(),
                }),
              ),
            );
          }, backoffDelay);
        } else {
          logger.error('Upload failed after maximum retries', {
            type,
            error,
            attempts: retryCount,
          });
          throw new AppError(
            ErrorCode.EXTERNAL_API_ERROR,
            'Upload failed after maximum retries',
            500,
            true,
            { details: { error, retryCount } },
          );
        }
      }
    } catch (error) {
      logger.error('Error in handleQueuedUpload:', error);
      throw error;
    }
  }

  /**
   * Handle queued media deletion operation
   * Processes delete requests from the queue with proper cleanup
   */
  private async handleQueuedDelete(data: Record<string, unknown>): Promise<void> {
    try {
      // Validate delete data
      if (!this.validateDeleteData(data)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid delete data format', 400, true, {
          details: data,
        });
      }

      const { mediaId, permanent = false, retryCount = 0 } = data as QueuedDeleteData;

      logger.info('Processing queued deletion', {
        mediaId,
        permanent,
        retryCount,
      });

      try {
        // Find media record first
        const media = await WhatsAppMediaModel.findOne({ whatsappMediaId: mediaId });
        if (!media) {
          logger.warn('Media not found in database', { mediaId });
          return;
        }

        if (permanent) {
          // Delete from WhatsApp first
          await this.deleteMedia(mediaId);

          // Then remove from database
          await WhatsAppMediaModel.deleteOne({ whatsappMediaId: mediaId });

          logger.info('Permanently deleted media', { mediaId });
        } else {
          // Soft delete - update status only
          await WhatsAppMediaModel.updateOne(
            { whatsappMediaId: mediaId },
            {
              status: 'deleted',
              $set: { 'metadata.deletedAt': new Date() },
            },
          );

          logger.info('Soft deleted media', { mediaId });
        }
      } catch (error) {
        // Handle retries for failed deletions
        if (retryCount < this.UPLOAD_RETRY_ATTEMPTS) {
          logger.warn(
            `Deletion failed, scheduling retry (${retryCount + 1}/${this.UPLOAD_RETRY_ATTEMPTS})`,
            {
              mediaId,
              error,
            },
          );

          const backoffDelay = Math.min(Math.pow(2, retryCount) * 1000, 30000);

          setTimeout(async () => {
            const channel = await RabbitMQ.createChannel('whatsapp_media_retry');
            await channel.publish(
              '',
              this.QUEUE_NAME,
              Buffer.from(
                JSON.stringify({
                  type: MediaQueueMessageType.DELETE,
                  data: {
                    ...data,
                    retryCount: retryCount + 1,
                  },
                  timestamp: Date.now(),
                }),
              ),
            );
          }, backoffDelay);
        } else {
          throw new AppError(
            ErrorCode.EXTERNAL_API_ERROR,
            'Deletion failed after maximum retries',
            500,
            true,
            { details: { error, retryCount } },
          );
        }
      }
    } catch (error) {
      logger.error('Error in handleQueuedDelete:', error);
      throw error;
    }
  }

  /**
   * Handle queued cleanup operations
   * Performs maintenance tasks like removing old media and syncing with WhatsApp
   */
  private async handleQueuedCleanup(data: Record<string, unknown>): Promise<void> {
    try {
      const {
        olderThan = 30, // Default 30 days
        syncWithWhatsApp = false,
        batchSize = this.CHUNK_SIZE,
      } = data as QueuedCleanupData;

      logger.info('Starting cleanup operation', {
        olderThan,
        syncWithWhatsApp,
        batchSize,
      });

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThan);

      // Find old deleted media
      const oldMedia = await WhatsAppMediaModel.find({
        status: 'deleted',
        updatedAt: { $lt: cutoffDate },
      }).limit(1000); // Limit to prevent memory issues

      logger.info(`Found ${oldMedia.length} old media records to clean up`);

      // Process in batches
      for (let i = 0; i < oldMedia.length; i += batchSize) {
        const batch = oldMedia.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (media) => {
            try {
              // Try to delete from WhatsApp if not already deleted
              try {
                await this.deleteMedia(media.whatsappMediaId);
              } catch (error) {
                // Ignore 404 errors as media might be already deleted
                if (error instanceof AppError && error.statusCode !== 404) {
                  throw error;
                }
              }

              // Remove from database
              await WhatsAppMediaModel.deleteOne({ _id: media._id });

              logger.debug('Cleaned up media', {
                id: media.whatsappMediaId,
                type: media.type,
              });
            } catch (error) {
              logger.error('Failed to clean up media', {
                id: media.whatsappMediaId,
                error,
              });
            }
          }),
        );

        // Add small delay between batches to prevent rate limiting
        if (i + batchSize < oldMedia.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info('Cleanup operation completed');
    } catch (error) {
      logger.error('Error in handleQueuedCleanup:', error);
      throw error;
    }
  }

  /**
   * Validate upload data format
   */
  private validateUploadData(data: unknown): data is QueuedUploadData {
    if (typeof data !== 'object' || data === null) return false;

    const upload = data as Partial<QueuedUploadData>;

    return (
      Buffer.isBuffer(upload.file) &&
      typeof upload.type === 'string' &&
      Object.values(WhatsAppMediaType).includes(upload.type as WhatsAppMediaType) &&
      typeof upload.mimeType === 'string' &&
      typeof upload.uploadedBy === 'string' &&
      Types.ObjectId.isValid(upload.uploadedBy) &&
      (upload.metadata === undefined || typeof upload.metadata === 'object')
    );
  }

  /**
   * Validate delete data format
   */
  private validateDeleteData(data: unknown): data is QueuedDeleteData {
    if (typeof data !== 'object' || data === null) return false;

    const deleteData = data as Partial<QueuedDeleteData>;

    return (
      typeof deleteData.mediaId === 'string' &&
      (deleteData.permanent === undefined || typeof deleteData.permanent === 'boolean') &&
      (deleteData.retryCount === undefined || typeof deleteData.retryCount === 'number')
    );
  }
}

export const whatsappMediaService = WhatsAppMediaService.getInstance();
