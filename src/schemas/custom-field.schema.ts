// src/schemas/custom-field.schema.ts

import { z } from 'zod';
import { CustomFieldType } from '@/types/customer.js';
import { Types } from 'mongoose';

/**
 * Base validation schema for field name
 * Enforces naming conventions and security
 */
const nameSchema = z
  .string()
  .min(2, 'Field name must be at least 2 characters')
  .max(50, 'Field name is too long')
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message:
      'Field name must start with a letter and contain only letters, numbers, and underscores',
  });

/**
 * Validation schema for custom field validation rules
 */
const validationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Base validation schema for custom field properties
 */
const baseCustomFieldSchema = {
  name: nameSchema,
  type: z.nativeEnum(CustomFieldType),
  required: z.boolean().optional().default(false),
  listOptions: z
    .array(z.string())
    .optional()
    .refine((val) => !val || val.length > 0, {
      message: 'List options cannot be empty if provided',
    }),
  defaultValue: z.unknown().optional(),
  description: z.string().max(200, 'Description is too long').optional(),
  validation: validationSchema.optional(),
};

/**
 * Helper function to validate MongoDB ObjectId
 */
const objectIdValidation = (fieldName: string): z.ZodEffects<z.ZodString, string, string> =>
  z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });

/**
 * Export validation schemas for all custom field operations
 */
export const customFieldSchemas = {
  /**
   * Schema for creating a new custom field
   */
  create: z.object({
    body: z
      .object(baseCustomFieldSchema)
      .refine(
        (data) => {
          if (data.type === CustomFieldType.LIST) {
            return Array.isArray(data.listOptions) && data.listOptions.length > 0;
          }
          return true;
        },
        {
          message: 'List options are required for LIST type fields',
          path: ['listOptions'],
        },
      )
      .refine(
        (data) => {
          if (data.defaultValue !== undefined) {
            switch (data.type) {
              case CustomFieldType.NUMBER:
                return typeof data.defaultValue === 'number';
              case CustomFieldType.TEXT:
                return typeof data.defaultValue === 'string';
              case CustomFieldType.BOOLEAN:
                return typeof data.defaultValue === 'boolean';
              case CustomFieldType.LIST:
                return (
                  typeof data.defaultValue === 'string' &&
                  data.listOptions?.includes(data.defaultValue)
                );
              case CustomFieldType.DATE:
                return !isNaN(Date.parse(data.defaultValue as string));
            }
          }
          return true;
        },
        {
          message: 'Default value must match the field type',
          path: ['defaultValue'],
        },
      ),
  }),

  /**
   * Schema for updating an existing custom field
   */
  update: z.object({
    params: z.object({
      fieldId: objectIdValidation('field'),
    }),
    body: z
      .object({
        ...baseCustomFieldSchema,
        name: nameSchema.optional(),
        type: z.nativeEnum(CustomFieldType).optional(),
      })
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
      }),
  }),

  /**
   * Schema for deleting a custom field
   */
  delete: z.object({
    params: z.object({
      fieldId: objectIdValidation('field'),
    }),
  }),

  /**
   * Schema for getting a custom field by ID
   */
  get: z.object({
    params: z.object({
      fieldId: objectIdValidation('field'),
    }),
  }),

  /**
   * Schema for listing custom fields with pagination
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
    }),
  }),

  /**
   * Schema for batch updating custom fields
   */
  batchUpdate: z.object({
    body: z.object({
      fields: z
        .array(
          z.object({
            id: objectIdValidation('field'),
            updates: z.object({
              ...baseCustomFieldSchema,
              name: nameSchema.optional(),
              type: z.nativeEnum(CustomFieldType).optional(),
            }),
          }),
        )
        .min(1, 'At least one field update is required')
        .max(50, 'Too many fields in batch update'),
    }),
  }),
};
