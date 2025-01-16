// src/schemas/whatsapp-template.schema.ts

import { z } from 'zod';
import { Types } from 'mongoose';
import {
  WhatsAppTemplateComponentType,
  WhatsAppTemplateStatus,
  WhatsAppTemplateCategory,
  WhatsAppParameterType,
} from '@/types/whatsapp.template.js';

/**
 * Helper function to validate MongoDB ObjectId
 */
const objectIdValidation = (fieldName: string): z.ZodEffects<z.ZodString, string, string> =>
  z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });

/**
 * Parameter schemas based on type
 */
const templateParameterSchema = z.discriminatedUnion('type', [
  // Text parameter
  z.object({
    type: z.literal(WhatsAppParameterType.TEXT),
    text: z.string().min(1).max(1000),
  }),

  // Media parameter
  z.object({
    type: z.enum([
      WhatsAppParameterType.IMAGE,
      WhatsAppParameterType.VIDEO,
      WhatsAppParameterType.DOCUMENT,
    ]),
    media: z.object({
      link: z.string().url(),
      filename: z.string().optional(),
    }),
  }),

  // Currency parameter
  z.object({
    type: z.literal(WhatsAppParameterType.CURRENCY),
    currency: z.object({
      fallback_value: z.string(),
      code: z.string().length(3),
      amount_1000: z.number().positive(),
    }),
  }),

  // Date/Time parameter
  z.object({
    type: z.literal(WhatsAppParameterType.DATE_TIME),
    date_time: z.object({
      fallback_value: z.string(),
      timestamp: z.number().optional(),
    }),
  }),

  // Payload parameter (for buttons)
  z.object({
    type: z.literal(WhatsAppParameterType.PAYLOAD),
    payload: z.string().max(1000),
  }),
]);

/**
 * Component schema
 */
const templateComponentSchema = z
  .object({
    type: z.nativeEnum(WhatsAppTemplateComponentType),
    text: z.string().optional(),
    parameters: z.array(templateParameterSchema).optional(),
    sub_type: z.enum(['quick_reply', 'url']).optional(),
    index: z.number().min(0).max(2).optional(),
  })
  .refine(
    (data) => {
      // If it's a button, it must have a sub_type and index
      if (data.type === WhatsAppTemplateComponentType.BUTTONS) {
        return data.sub_type !== undefined && data.index !== undefined;
      }
      return true;
    },
    {
      message: 'Button components must have sub_type and index',
    },
  );

/**
 * Language schema
 */
const templateLanguageSchema = z.object({
  code: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
  policy: z.string().optional(),
});

/**
 * Export validation schemas for all template operations
 */
export const whatsappTemplateSchemas = {
  /**
   * Create template request validation
   */
  create: z.object({
    body: z.object({
      name: z
        .string()
        .min(2)
        .max(50)
        .regex(
          /^[a-z0-9_]+$/,
          'Template name must contain only lowercase letters, numbers, and underscores',
        ),
      category: z.nativeEnum(WhatsAppTemplateCategory),
      components: z
        .array(templateComponentSchema)
        .min(1)
        .max(5)
        .refine(
          (components) => {
            // Validate button indices are unique if buttons exist
            const buttonIndices = components
              .filter((c) => c.type === WhatsAppTemplateComponentType.BUTTONS)
              .map((c) => c.index);
            return new Set(buttonIndices).size === buttonIndices.length;
          },
          {
            message: 'Button indices must be unique',
          },
        ),
      language: templateLanguageSchema,
      metadata: z
        .record(z.unknown())
        .optional()
        .refine((val) => !val || Object.keys(val).length <= 20, {
          message: 'Maximum 20 metadata fields allowed',
        }),
    }),
  }),

  /**
   * Update template request validation
   */
  update: z.object({
    params: z.object({
      id: objectIdValidation('template'),
    }),
    body: z
      .object({
        category: z.nativeEnum(WhatsAppTemplateCategory).optional(),
        components: z.array(templateComponentSchema).min(1).max(5).optional(),
        language: templateLanguageSchema.optional(),
        metadata: z
          .record(z.unknown())
          .optional()
          .refine((val) => !val || Object.keys(val).length <= 20, {
            message: 'Maximum 20 metadata fields allowed',
          }),
      })
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
      }),
  }),

  /**
   * Get template by ID validation
   */
  getById: z.object({
    params: z.object({
      id: objectIdValidation('template'),
    }),
  }),

  /**
   * Delete template validation
   */
  delete: z.object({
    params: z.object({
      id: objectIdValidation('template'),
    }),
  }),

  /**
   * List templates validation
   */
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
      category: z.nativeEnum(WhatsAppTemplateCategory).optional(),
      status: z.nativeEnum(WhatsAppTemplateStatus).optional(),
      language: z
        .string()
        .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
        .optional(),
      search: z.string().optional(),
    }),
  }),
};
