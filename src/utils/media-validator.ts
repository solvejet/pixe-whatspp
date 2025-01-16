// src/utils/media-validator.ts

import { AppError, ErrorCode } from './error-service.js';

/**
 * Interface for Multer file with complete type definitions
 */
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination?: string;
  filename?: string;
  path?: string;
  buffer?: Buffer;
}

/**
 * Media constraints based on WhatsApp Business API limitations
 * @see https://developers.facebook.com/docs/whatsapp/api/media
 */
export const MEDIA_CONSTRAINTS = {
  AUDIO: {
    maxSize: 16 * 1024 * 1024, // 16MB - WhatsApp limit
    allowedTypes: new Set([
      'audio/aac',
      'audio/mp4',
      'audio/amr',
      'audio/mpeg', // MP3
      'audio/ogg',
    ]),
    allowedExtensions: new Set(['.aac', '.mp4', '.amr', '.mp3', '.ogg']),
    maxDuration: 16 * 60, // 16 minutes max for voice messages
  },
  DOCUMENT: {
    maxSize: 100 * 1024 * 1024, // 100MB - WhatsApp limit
    allowedTypes: new Set([
      'text/plain', // txt
      'application/vnd.ms-excel', // xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/msword', // doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
      'application/vnd.ms-powerpoint', // ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
      'application/pdf', // pdf
    ]),
    allowedExtensions: new Set(['.txt', '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx', '.pdf']),
  },
  IMAGE: {
    maxSize: 5 * 1024 * 1024, // 5MB - WhatsApp limit
    allowedTypes: new Set([
      'image/jpeg',
      'image/png',
      'image/webp', // WhatsApp supports WebP
    ]),
    allowedExtensions: new Set(['.jpg', '.jpeg', '.png', '.webp']),
    maxDimensions: {
      width: 5000,
      height: 5000,
    },
  },
  VIDEO: {
    maxSize: 16 * 1024 * 1024, // 16MB - WhatsApp limit
    allowedTypes: new Set(['video/mp4', 'video/3gpp']),
    allowedExtensions: new Set(['.mp4', '.3gp']),
    maxDuration: 180, // 3 minutes max for videos
  },
} as const;

/**
 * Magic numbers for file type validation
 */
const FILE_SIGNATURES = {
  // Images
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  // Documents
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  // Add more signatures as needed
} as const;

export interface FileValidationOptions {
  skipSizeCheck?: boolean;
  skipMagicNumberCheck?: boolean;
}

export class MediaValidator {
  /**
   * Get media category from MIME type
   */
  private static getMediaCategory(mimeType: string): keyof typeof MEDIA_CONSTRAINTS {
    if (MEDIA_CONSTRAINTS.AUDIO.allowedTypes.has(mimeType)) return 'AUDIO';
    if (MEDIA_CONSTRAINTS.DOCUMENT.allowedTypes.has(mimeType)) return 'DOCUMENT';
    if (MEDIA_CONSTRAINTS.IMAGE.allowedTypes.has(mimeType)) return 'IMAGE';
    if (MEDIA_CONSTRAINTS.VIDEO.allowedTypes.has(mimeType)) return 'VIDEO';

    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unsupported file type', 400, true, {
      details: { mimeType },
    });
  }

  /**
   * Format bytes to human readable format
   */
  private static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Validate file extension
   */
  private static validateExtension(filename: string, mimeType: string): void {
    const extension = filename.toLowerCase().split('.').pop();
    if (!extension) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'File must have an extension', 400, true, {
        details: { filename },
      });
    }

    const category = this.getMediaCategory(mimeType);
    const allowedExtensions = MEDIA_CONSTRAINTS[category].allowedExtensions;

    if (!allowedExtensions.has(`.${extension}`)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid file extension for ${category.toLowerCase()}`,
        400,
        true,
        {
          details: {
            extension: `.${extension}`,
            allowedExtensions: Array.from(allowedExtensions),
          },
        },
      );
    }
  }

  /**
   * Validate file using magic numbers
   */
  private static validateMagicNumbers(buffer: Buffer, mimeType: string): void {
    const signatures = FILE_SIGNATURES[mimeType as keyof typeof FILE_SIGNATURES];
    if (!signatures) return; // Skip if no signatures defined

    const isValid = signatures.some((signature) =>
      signature.every((byte, index) => buffer[index] === byte),
    );

    if (!isValid) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'File content does not match its extension',
        400,
        true,
        { details: { mimeType } },
      );
    }
  }

  /**
   * Get media constraints for a given MIME type
   */
  public static getMediaConstraints(mimeType: string): {
    maxSize: number;
    allowedTypes: Set<string>;
    allowedExtensions: Set<string>;
  } {
    const category = this.getMediaCategory(mimeType);
    return MEDIA_CONSTRAINTS[category];
  }

  /**
   * Validate file against WhatsApp constraints
   */
  public static validateFile(file: MulterFile, options?: FileValidationOptions): void {
    const category = this.getMediaCategory(file.mimetype);
    const constraints = MEDIA_CONSTRAINTS[category];

    // Validate MIME type
    if (!constraints.allowedTypes.has(file.mimetype)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported ${category.toLowerCase()} file type`,
        400,
        true,
        {
          details: {
            mimeType: file.mimetype,
            allowedTypes: Array.from(constraints.allowedTypes),
          },
        },
      );
    }

    // Validate file extension
    this.validateExtension(file.originalname, file.mimetype);

    // Validate file size
    if (!options?.skipSizeCheck && file.size > constraints.maxSize) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `File size exceeds WhatsApp limit for ${category.toLowerCase()}`,
        400,
        true,
        {
          details: {
            size: this.formatBytes(file.size),
            maxSize: this.formatBytes(constraints.maxSize),
          },
        },
      );
    }

    // Validate file content if buffer is available
    if (!options?.skipMagicNumberCheck && file.buffer) {
      this.validateMagicNumbers(file.buffer, file.mimetype);
    }
  }
}
