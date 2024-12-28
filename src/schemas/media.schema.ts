// src/schemas/media.schema.ts
import { z } from 'zod';
import { Types } from 'mongoose';
import { MediaStatus, MediaType } from '@/models/media.model.js';

// Helper function to validate MongoDB ObjectId
const objectIdValidation = (fieldName: string): z.ZodEffects<z.ZodString, string, string> => {
  return z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });
};

// File validation schema
const fileValidation = z.object({
  fieldname: z.string(),
  originalname: z.string(),
  encoding: z.string(),
  mimetype: z.string(),
  size: z.number(),
  buffer: z.instanceof(Buffer),
});

export const mediaSchemas = {
  // Upload single media
  upload: z.object({
    file: fileValidation,
  }),

  // Upload multiple media files
  bulkUpload: z.object({
    files: z.array(fileValidation).min(1).max(10),
  }),

  // Get media by ID
  getById: z.object({
    params: z.object({
      id: objectIdValidation('media'),
    }),
  }),

  // Delete media
  delete: z.object({
    params: z.object({
      id: objectIdValidation('media'),
    }),
  }),

  // List media with query parameters
  list: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 1))
        .refine((val) => val > 0, { message: 'Page must be greater than 0' }),
      limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 10))
        .refine((val) => val > 0 && val <= 100, {
          message: 'Limit must be between 1 and 100',
        }),
      type: z.nativeEnum(MediaType).optional(),
      status: z.nativeEnum(MediaStatus).optional(),
    }),
  }),
};
