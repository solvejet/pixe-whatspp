// src/schemas/whatsapp-media.schema.ts

import { z } from 'zod';
import { WhatsAppMediaType } from '@/types/whatsapp.media.js';

export const whatsappMediaSchemas = {
  // Schema for single file upload
  upload: z.object({
    body: z.object({
      type: z.nativeEnum(WhatsAppMediaType),
      metadata: z
        .string()
        .optional()
        .transform((val) => (val ? JSON.parse(val) : undefined))
        .refine(
          (val) => {
            if (!val) return true;
            return typeof val === 'object' && !Array.isArray(val);
          },
          { message: 'Metadata must be a valid JSON object' },
        ),
    }),
    file: z
      .object({
        buffer: z.instanceof(Buffer),
        mimetype: z.string(),
        size: z.number().max(16 * 1024 * 1024, 'File size must not exceed 16MB'),
      })
      .optional(),
  }),

  // Schema for bulk upload
  bulkUpload: z.object({
    body: z.object({
      type: z.nativeEnum(WhatsAppMediaType),
      metadata: z
        .string()
        .optional()
        .transform((val) => (val ? JSON.parse(val) : undefined))
        .refine(
          (val) => {
            if (!val) return true;
            return typeof val === 'object' && !Array.isArray(val);
          },
          { message: 'Metadata must be a valid JSON object' },
        ),
    }),
    files: z
      .array(
        z.object({
          buffer: z.instanceof(Buffer),
          mimetype: z.string(),
          size: z.number().max(16 * 1024 * 1024, 'File size must not exceed 16MB'),
        }),
      )
      .min(1, 'At least one file is required')
      .max(10, 'Maximum 10 files allowed')
      .optional(),
  }),

  // Schema for media operations by ID
  mediaById: z.object({
    params: z.object({
      mediaId: z.string().min(1, 'Media ID is required'),
    }),
  }),
};
