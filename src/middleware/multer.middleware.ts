// src/middleware/multer.middleware.ts

import multer from 'multer';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { MediaValidator, MEDIA_CONSTRAINTS } from '@/utils/media-validator.js';
import { logger } from '@/utils/logger.js';

interface MulterError extends Error {
  code: string;
  field?: string;
}

/**
 * Configuration for file uploads using Multer
 */
const UPLOAD_CONFIG = {
  // Maximum file sizes in bytes
  MAX_FILE_SIZE: Math.max(
    MEDIA_CONSTRAINTS.AUDIO.maxSize,
    MEDIA_CONSTRAINTS.DOCUMENT.maxSize,
    MEDIA_CONSTRAINTS.IMAGE.maxSize,
    MEDIA_CONSTRAINTS.VIDEO.maxSize,
  ),
  MAX_FILES: 10, // Maximum number of files per request
  ALLOWED_MIME_TYPES: [
    ...MEDIA_CONSTRAINTS.AUDIO.allowedTypes,
    ...MEDIA_CONSTRAINTS.DOCUMENT.allowedTypes,
    ...MEDIA_CONSTRAINTS.IMAGE.allowedTypes,
    ...MEDIA_CONSTRAINTS.VIDEO.allowedTypes,
  ],
} as const;

/**
 * Storage configuration for Multer
 * Using memory storage for better security and cloud upload compatibility
 */
const storage = multer.memoryStorage();

/**
 * Generate a secure unique filename
 */
function generateSecureFilename(originalname: string): string {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = originalname.split('.').pop()?.toLowerCase() ?? '';
  return `${timestamp}-${randomString}.${extension}`;
}

/**
 * File filter function to validate uploads
 */
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
): void => {
  try {
    // Check if file type is allowed
    if (!UPLOAD_CONFIG.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid file type', 400, true, {
          details: {
            mimetype: file.mimetype,
            allowedTypes: UPLOAD_CONFIG.ALLOWED_MIME_TYPES,
          },
        }),
      );
      return;
    }

    // Validate file using MediaValidator
    MediaValidator.validateFile(
      {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      { skipSizeCheck: true }, // Size will be checked by multer limits
    );

    // Generate secure filename
    file.originalname = generateSecureFilename(file.originalname);

    callback(null, true);
  } catch (error) {
    callback(
      error instanceof Error
        ? new AppError(ErrorCode.VALIDATION_ERROR, error.message, 400)
        : new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid file', 400),
    );
  }
};

/**
 * Multer configuration for single file uploads
 */
export const uploadSingle = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
    files: 1,
  },
}).single('file');

/**
 * Multer configuration for multiple file uploads
 */
export const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
    files: UPLOAD_CONFIG.MAX_FILES,
  },
}).array('files', UPLOAD_CONFIG.MAX_FILES);

/**
 * Error handler middleware for multer errors
 */
export const handleMulterError = (
  err: Error,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (err instanceof multer.MulterError || isMulterError(err)) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `File size exceeds limit of ${UPLOAD_CONFIG.MAX_FILE_SIZE} bytes`,
            400,
            true,
            { details: { maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE } },
          ),
        );
        break;
      case 'LIMIT_FILE_COUNT':
        next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Too many files. Maximum ${UPLOAD_CONFIG.MAX_FILES} files allowed`,
            400,
            true,
            { details: { maxFiles: UPLOAD_CONFIG.MAX_FILES } },
          ),
        );
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Unexpected field name for file upload',
            400,
            true,
            { details: { field: err.field } },
          ),
        );
        break;
      default:
        logger.error('Unexpected Multer error:', {
          code: err.code,
          message: err.message,
          field: err.field,
        });
        next(
          new AppError(ErrorCode.VALIDATION_ERROR, 'File upload error', 400, true, {
            details: { error: err.message },
          }),
        );
    }
    return;
  }
  next(err);
};

/**
 * Type guard for MulterError
 */
function isMulterError(error: Error): error is MulterError {
  return 'code' in error;
}

/**
 * Type guard to check if a request contains files
 */
export function hasUploadedFiles(req: Request): req is Request & { files: Express.Multer.File[] } {
  return 'files' in req && Array.isArray(req.files) && req.files.length > 0;
}

/**
 * Type guard to check if a request contains a single file
 */
export function hasUploadedFile(req: Request): req is Request & { file: Express.Multer.File } {
  return 'file' in req && req.file !== undefined && req.file !== null;
}
