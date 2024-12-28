// src/services/media.service.ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { Types } from 'mongoose';
import type { ConsumeMessage } from 'amqplib';
import type { Channel } from 'amqplib';
import {
  MediaModel,
  MediaStatus,
  MediaType,
  type ICreateMedia,
  type IMedia,
  type IMediaDocument,
} from '@/models/media.model.js';
import type {
  IMediaResponse,
  MediaUploadResponse,
  BulkUploadResponse,
  WhatsAppMediaUploadResponse,
  MediaUploadJob,
  MediaServiceConfig,
  MulterFile,
} from '@/types/media.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import { env } from '@/config/env.js';
import { MediaValidator } from '@/utils/media-validator.js';

/**
 * Interface for WhatsApp media download response
 */
interface WhatsAppMediaDownloadResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
  messaging_product: string;
}

export class MediaService {
  private static instance: MediaService;
  private readonly UPLOAD_QUEUE = 'media_upload';
  private readonly config: MediaServiceConfig;
  private uploadChannel: Channel | null = null;

  private constructor() {
    this.config = {
      uploadPath: path.join(process.cwd(), 'uploads'),
      maxFileSize: env.WHATSAPP_UPLOAD_MAX_SIZE,
      allowedTypes: env.WHATSAPP_UPLOAD_ALLOWED_TYPES.split(','),
      whatsapp: {
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        maxFileSize: env.WHATSAPP_UPLOAD_MAX_SIZE,
        allowedTypes: env.WHATSAPP_UPLOAD_ALLOWED_TYPES.split(','),
      },
    };
    void this.initializeUploadProcessor();
  }

  public static getInstance(): MediaService {
    if (!MediaService.instance) {
      MediaService.instance = new MediaService();
    }
    return MediaService.instance;
  }

  private async initializeUploadProcessor(): Promise<void> {
    try {
      this.uploadChannel = await RabbitMQ.createChannel('media_upload_processor');

      await RabbitMQ.assertQueue(this.uploadChannel, this.UPLOAD_QUEUE, {
        durable: true,
        deadLetterExchange: 'dlx',
        deadLetterRoutingKey: 'dlq.media_upload',
      });

      await this.uploadChannel.prefetch(1);

      void this.uploadChannel.consume(this.UPLOAD_QUEUE, async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const job = JSON.parse(msg.content.toString()) as MediaUploadJob;
          await this.processUpload(job);
          this.uploadChannel?.ack(msg);
        } catch (error) {
          logger.error('Error processing upload job:', error);

          const retryCount = (msg.properties.headers?.['x-retry-count'] as number) ?? 0;
          if (retryCount < 3) {
            this.uploadChannel?.nack(msg, false, true);
          } else {
            this.uploadChannel?.nack(msg, false, false);
          }
        }
      });
    } catch (error) {
      logger.error('Error initializing upload processor:', error);
    }
  }

  private getMediaType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/')) return MediaType.IMAGE;
    if (mimeType.startsWith('video/')) return MediaType.VIDEO;
    if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
    return MediaType.DOCUMENT;
  }

  private async validateFile(
    file: MulterFile,
    options?: { skipSizeCheck?: boolean },
  ): Promise<void> {
    try {
      MediaValidator.validateFile(file, options);

      if (file.size > this.config.whatsapp.maxFileSize) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'File size exceeds WhatsApp limit',
          400,
          true,
          {
            details: {
              size: file.size,
              maxSize: this.config.whatsapp.maxFileSize,
            },
          },
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;

      throw new AppError(ErrorCode.VALIDATION_ERROR, 'File validation failed', 400, true, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private async saveFile(file: MulterFile): Promise<string> {
    if (!file.buffer) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'File buffer is required', 400);
    }

    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = uniquePrefix + '-' + file.originalname;
    const filePath = path.join(this.config.uploadPath, fileName);

    await fs.mkdir(this.config.uploadPath, { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    return filePath;
  }

  private async uploadToWhatsApp(
    filePath: string,
    mimeType: string,
  ): Promise<WhatsAppMediaUploadResponse> {
    try {
      const form = new FormData();
      const fileBuffer = await fs.readFile(filePath);
      const file = new Blob([fileBuffer], { type: mimeType });

      form.append('file', file);
      form.append('type', mimeType);
      form.append('messaging_product', 'whatsapp');

      const response = await fetch(
        `https://graph.facebook.com/v21.0/${this.config.whatsapp.phoneNumberId}/media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.whatsapp.accessToken}`,
          },
          body: form,
        },
      );

      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${response.statusText}`);
      }

      return (await response.json()) as WhatsAppMediaUploadResponse;
    } catch (error) {
      logger.error('Error uploading to WhatsApp:', error);
      throw new AppError(
        ErrorCode.EXTERNAL_API_ERROR,
        'Failed to upload media to WhatsApp',
        500,
        false,
        {
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      );
    }
  }

  private async processUpload(job: MediaUploadJob): Promise<void> {
    const media = await MediaModel.findById(job.mediaId);
    if (!media) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Media record not found', 404);
    }

    try {
      media.status = MediaStatus.UPLOADING;
      await media.save();

      const whatsappResponse = await this.uploadToWhatsApp(job.filePath, job.mimeType);

      media.whatsappMediaId = whatsappResponse.id;
      media.url = whatsappResponse.url;
      media.sha256 = whatsappResponse.sha256;
      media.status = MediaStatus.UPLOADED;
      await media.save();

      await fs
        .unlink(job.filePath)
        .catch((error) => logger.error('Error deleting local file:', error));
    } catch (error) {
      media.status = MediaStatus.FAILED;
      media.error = error instanceof Error ? error.message : 'Unknown error';
      await media.save();
      throw error;
    }
  }

  private async queueUpload(
    mediaId: Types.ObjectId,
    filePath: string,
    mimeType: string,
  ): Promise<void> {
    if (!this.uploadChannel) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Upload service not available', 503);
    }

    const job: MediaUploadJob = { mediaId, filePath, mimeType };
    await this.uploadChannel.sendToQueue(this.UPLOAD_QUEUE, Buffer.from(JSON.stringify(job)), {
      persistent: true,
      headers: { 'x-retry-count': 0 },
    });
  }

  private formatMediaResponse(
    media:
      | IMediaDocument
      | (Omit<IMedia, 'metadata'> & { _id: Types.ObjectId; metadata?: Record<string, unknown> }),
  ): IMediaResponse {
    return {
      id: media._id.toString(),
      originalName: media.originalName,
      mimeType: media.mimeType,
      size: media.size,
      type: media.type,
      url: media.url,
      status: media.status,
      uploadedBy: media.uploadedBy.toString(),
      error: media.error,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }

  public async uploadMedia(file: MulterFile, userId: string): Promise<MediaUploadResponse> {
    try {
      await this.validateFile(file);
      const filePath = await this.saveFile(file);

      const mediaData: ICreateMedia = {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        type: this.getMediaType(file.mimetype),
        path: filePath,
        status: MediaStatus.PENDING,
        uploadedBy: new Types.ObjectId(userId),
      };

      const media = (await MediaModel.create(mediaData)) as IMediaDocument;

      await this.queueUpload(media._id, filePath, file.mimetype);

      return {
        id: media._id.toString(),
        originalName: media.originalName,
        status: media.status,
        type: media.type,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to process media upload',
        500,
        false,
        {
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      );
    }
  }

  public async bulkUpload(files: MulterFile[], userId: string): Promise<BulkUploadResponse> {
    const successful: MediaUploadResponse[] = [];
    const failed: Array<{ originalName: string; error: string }> = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          const result = await this.uploadMedia(file, userId);
          successful.push(result);
        } catch (error) {
          failed.push({
            originalName: file.originalname,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }),
    );

    return { successful, failed };
  }

  public async getMediaById(id: string): Promise<IMediaResponse> {
    const media = await MediaModel.findById(id);
    if (!media) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Media not found', 404);
    }
    return this.formatMediaResponse(media.toObject());
  }

  public async deleteMedia(id: string, userId: string): Promise<void> {
    const media = await MediaModel.findOne({
      _id: new Types.ObjectId(id),
      uploadedBy: new Types.ObjectId(userId),
    });

    if (!media) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Media not found', 404);
    }

    if (media.whatsappMediaId) {
      try {
        const response = await fetch(`https://graph.facebook.com/v21.0/${media.whatsappMediaId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.config.whatsapp.accessToken}`,
          },
        });

        if (!response.ok) {
          logger.error('Error deleting WhatsApp media:', await response.text());
        }
      } catch (error) {
        logger.error('Error deleting WhatsApp media:', error);
      }
    }

    if (media.path) {
      await fs
        .unlink(media.path)
        .catch((error) => logger.error('Error deleting local file:', error));
    }

    await media.deleteOne();
  }

  /**
   * List media with proper type handling for lean queries
   */
  public async listMedia(
    userId: string,
    page = 1,
    limit = 10,
    type?: MediaType,
    status?: MediaStatus,
  ): Promise<{ media: IMediaResponse[]; total: number; pages: number }> {
    try {
      const query: Record<string, unknown> = { uploadedBy: new Types.ObjectId(userId) };

      if (type) query.type = type;
      if (status) query.status = status;

      const [mediaResults, total] = await Promise.all([
        MediaModel.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean({ virtuals: true }), // Enable virtuals for proper typing
        MediaModel.countDocuments(query),
      ]);

      return {
        media: mediaResults.map((doc) =>
          this.formatMediaResponse({
            ...doc,
            _id: doc._id,
            metadata: doc.metadata || {},
          }),
        ),
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error listing media:', error);
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Failed to retrieve media list', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
          type,
          status,
        },
      });
    }
  }

  /**
   * Download media from WhatsApp Cloud API
   */
  public async downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
    try {
      // First, get the media URL
      const mediaInfoResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
        headers: {
          Authorization: `Bearer ${this.config.whatsapp.accessToken}`,
        },
      });

      if (!mediaInfoResponse.ok) {
        throw new Error(`Failed to get media info: ${mediaInfoResponse.statusText}`);
      }

      const mediaInfo = (await mediaInfoResponse.json()) as WhatsAppMediaDownloadResponse;

      // Download the media from the URL
      const mediaResponse = await fetch(mediaInfo.url, {
        headers: {
          Authorization: `Bearer ${this.config.whatsapp.accessToken}`,
        },
      });

      if (!mediaResponse.ok) {
        throw new Error(`Failed to download media: ${mediaResponse.statusText}`);
      }

      return Buffer.from(await mediaResponse.arrayBuffer());
    } catch (error) {
      logger.error('Error downloading WhatsApp media:', error);
      throw new AppError(
        ErrorCode.EXTERNAL_API_ERROR,
        'Failed to download media from WhatsApp',
        500,
        false,
        {
          details: {
            mediaId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      );
    }
  }
}

export const mediaService = MediaService.getInstance();
