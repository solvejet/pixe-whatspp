import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { MediaType, MediaStatus } from '@/models/media.model.js';
import { mediaService } from '@/services/media.service.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import {
  type ListMediaQuery,
  type MediaUploadRequest,
  type MediaBulkUploadRequest,
  hasFile,
  hasFiles,
  hasValidId,
  hasValidUser,
} from '@/types/media-request.js';

/**
 * Media Controller
 * Handles media file operations with enhanced security and performance
 */
export class MediaController {
  /**
   * Upload a single media file
   * @route POST /api/media/upload
   * @security RequireAuth
   */
  public async uploadMedia(
    req: MediaUploadRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasFile(req)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'No file provided', 400);
      }

      if (!hasValidUser(req)) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
      }

      const result = await mediaService.uploadMedia(req.file, req.user.userId);
      successResponse(res, result, 'File uploaded successfully', 201);
    } catch (error) {
      logger.error('Error in uploadMedia:', {
        error,
        userId: req.user?.userId,
        fileName: req.file?.originalname,
      });
      next(error);
    }
  }

  /**
   * Upload multiple media files
   * @route POST /api/media/bulk-upload
   * @security RequireAuth
   */
  public bulkUpload: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const bulkReq = req as MediaBulkUploadRequest;

      if (!hasFiles(bulkReq)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'No files provided', 400);
      }

      if (!hasValidUser(bulkReq)) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
      }

      const result = await mediaService.bulkUpload(bulkReq.files, bulkReq.user.userId);
      successResponse(res, result, 'Files uploaded successfully', 201);
    } catch (error) {
      logger.error('Error in bulkUpload:', {
        error,
        userId: (req as MediaBulkUploadRequest).user?.userId,
        fileCount: (req as MediaBulkUploadRequest).files?.length,
      });
      next(error);
    }
  };

  /**
   * Get media by ID
   * @route GET /api/media/:id
   * @security RequireAuth
   */
  public async getMediaById(
    req: MediaUploadRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasValidId(req)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid media ID', 400);
      }

      if (!Types.ObjectId.isValid(req.params.id)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid media ID format', 400, true, {
          details: { id: req.params.id },
        });
      }

      const media = await mediaService.getMediaById(req.params.id);
      successResponse(res, media);
    } catch (error) {
      logger.error('Error retrieving media:', {
        error,
        mediaId: req.params.id,
        userId: req.user?.userId,
      });
      next(error);
    }
  }

  /**
   * Delete media
   * @route DELETE /api/media/:id
   * @security RequireAuth
   */
  public async deleteMedia(
    req: MediaUploadRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasValidId(req) || !hasValidUser(req)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request parameters', 400);
      }

      if (!Types.ObjectId.isValid(req.params.id)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid media ID format', 400, true, {
          details: { id: req.params.id },
        });
      }

      await mediaService.deleteMedia(req.params.id, req.user.userId);
      successResponse(res, null, 'Media deleted successfully', 204);
    } catch (error) {
      logger.error('Error deleting media:', {
        error,
        mediaId: req.params.id,
        userId: req.user?.userId,
      });
      next(error);
    }
  }

  /**
   * List media files with pagination and filtering
   * @route GET /api/media
   * @security RequireAuth
   */
  public async listMedia(
    req: MediaUploadRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!hasValidUser(req)) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
      }

      const page = this.validatePageNumber(req.query.page);
      const limit = this.validateLimit(req.query.limit);
      const { type, status } = this.validateQueryParams(req.query);

      const result = await mediaService.listMedia(req.user.userId, page, limit, type, status);
      successResponse(res, result);
    } catch (error) {
      logger.error('Error listing media:', {
        error,
        userId: req.user?.userId,
        query: req.query,
      });
      next(error);
    }
  }

  /**
   * Validate and parse page number
   * @private
   */
  private validatePageNumber(page?: string): number {
    const parsedPage = parseInt(page || '1', 10);
    if (isNaN(parsedPage) || parsedPage < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid page number', 400, true, {
        details: { page },
      });
    }
    return parsedPage;
  }

  /**
   * Validate and parse limit
   * @private
   */
  private validateLimit(limit?: string): number {
    const parsedLimit = parseInt(limit || '10', 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid limit value. Must be between 1 and 100',
        400,
        true,
        { details: { limit } },
      );
    }
    return parsedLimit;
  }

  /**
   * Validate query parameters
   * @private
   */
  private validateQueryParams(query: ListMediaQuery): {
    type?: MediaType;
    status?: MediaStatus;
  } {
    const result: { type?: MediaType; status?: MediaStatus } = {};

    if (query.type) {
      if (!Object.values(MediaType).includes(query.type)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid media type', 400, true, {
          details: { type: query.type },
        });
      }
      result.type = query.type;
    }

    if (query.status) {
      if (!Object.values(MediaStatus).includes(query.status)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid status', 400, true, {
          details: { status: query.status },
        });
      }
      result.status = query.status;
    }

    return result;
  }
}
