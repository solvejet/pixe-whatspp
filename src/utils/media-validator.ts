// src/utils/media-validator.ts
import { AppError, ErrorCode } from './error-service.js';

// For type definitions
interface MulterFile {
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

export const MEDIA_CONSTRAINTS = {
  AUDIO: {
    maxSize: 16 * 1024 * 1024, // 16MB
    allowedTypes: [
      'audio/aac',
      'audio/amr',
      'audio/mpeg', // MP3
      'audio/mp4',
      'audio/ogg',
    ],
  },
  DOCUMENT: {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: [
      'text/plain', // txt
      'application/vnd.ms-excel', // xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/msword', // doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
      'application/vnd.ms-powerpoint', // ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
      'application/pdf', // pdf
    ],
  },
  IMAGE: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png'],
  },
  VIDEO: {
    maxSize: 16 * 1024 * 1024, // 16MB
    allowedTypes: ['video/3gpp', 'video/mp4'],
  },
};

export interface FileValidationOptions {
  skipSizeCheck?: boolean;
}

export class MediaValidator {
  private static getMediaCategory(mimeType: string): keyof typeof MEDIA_CONSTRAINTS {
    if (MEDIA_CONSTRAINTS.AUDIO.allowedTypes.includes(mimeType)) return 'AUDIO';
    if (MEDIA_CONSTRAINTS.DOCUMENT.allowedTypes.includes(mimeType)) return 'DOCUMENT';
    if (MEDIA_CONSTRAINTS.IMAGE.allowedTypes.includes(mimeType)) return 'IMAGE';
    if (MEDIA_CONSTRAINTS.VIDEO.allowedTypes.includes(mimeType)) return 'VIDEO';

    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unsupported file type', 400, true, {
      details: { mimeType },
    });
  }

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

  public static getMediaConstraints(mimeType: string): {
    maxSize: number;
    allowedTypes: string[];
  } {
    const category = this.getMediaCategory(mimeType);
    return MEDIA_CONSTRAINTS[category];
  }

  public static validateFile(file: MulterFile, options?: FileValidationOptions): void {
    const category = this.getMediaCategory(file.mimetype);
    const constraints = MEDIA_CONSTRAINTS[category];

    if (!constraints.allowedTypes.includes(file.mimetype)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported ${category.toLowerCase()} file type. Allowed types: ${constraints.allowedTypes.join(
          ', ',
        )}`,
        400,
        true,
        { details: { mimeType: file.mimetype } },
      );
    }

    if (!options?.skipSizeCheck && file.size > constraints.maxSize) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `File size exceeds the maximum allowed size for ${category.toLowerCase()} files (${this.formatBytes(
          constraints.maxSize,
        )})`,
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
  }
}
