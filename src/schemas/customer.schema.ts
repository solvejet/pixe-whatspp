// src/schemas/customer.schema.ts
import { z } from 'zod';
import { Types } from 'mongoose';
import { CustomerStatus, CustomFieldType } from '@/types/customer.js';

/**
 * Helper function to validate MongoDB ObjectId
 */
const objectIdValidation = (fieldName: string) => {
  return z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });
};

/**
 * Base validation schemas for custom fields
 */
const customFieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  message: z.string().optional(),
});

const customFieldSchema = z.object({
  name: z.string().min(1, 'Field name is required').max(100, 'Field name is too long'),
  type: z.nativeEnum(CustomFieldType),
  required: z.boolean().optional(),
  listOptions: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  validation: customFieldValidationSchema.optional(),
});

/**
 * Phone number validation regex - supports international format
 */
const phoneRegex = /^\+?[1-9]\d{1,14}$/;

/**
 * Customer schema validations
 */
export const customerSchemas = {
  /**
   * Create customer request validation
   */
  create: z.object({
    body: z.object({
      name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name is too long')
        .trim(),
      phoneNumber: z
        .string()
        .regex(phoneRegex, 'Invalid phone number format')
        .min(8, 'Phone number must be at least 8 characters')
        .max(15, 'Phone number is too long'),
      countryCode: z
        .string()
        .regex(/^[A-Z]{2}$/, 'Country code must be 2 uppercase letters')
        .trim(),
      assignedAdmin: objectIdValidation('assigned admin'),
      status: z.nativeEnum(CustomerStatus).optional().default(CustomerStatus.ACTIVE),
      customFields: z
        .record(z.string(), z.unknown())
        .optional()
        .refine(
          (fields) => {
            if (!fields) return true;
            return Object.keys(fields).length <= 50;
          },
          { message: 'Too many custom fields' },
        ),
      groups: z.array(objectIdValidation('group')).optional(),
      tags: z.array(z.string().min(1).max(50)).max(20, 'Maximum 20 tags allowed').optional(),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .refine(
          (metadata) => {
            if (!metadata) return true;
            return Object.keys(metadata).length <= 20;
          },
          { message: 'Too many metadata fields' },
        ),
    }),
  }),

  /**
   * Update customer request validation
   */
  update: z.object({
    params: z.object({
      id: objectIdValidation('customer'),
    }),
    body: z
      .object({
        name: z
          .string()
          .min(2, 'Name must be at least 2 characters')
          .max(100, 'Name is too long')
          .trim()
          .optional(),
        phoneNumber: z
          .string()
          .regex(phoneRegex, 'Invalid phone number format')
          .min(8, 'Phone number must be at least 8 characters')
          .max(15, 'Phone number is too long')
          .optional(),
        countryCode: z
          .string()
          .regex(/^[A-Z]{2}$/, 'Country code must be 2 uppercase letters')
          .trim()
          .optional(),
        assignedAdmin: objectIdValidation('assigned admin').optional(),
        status: z.nativeEnum(CustomerStatus).optional(),
        customFields: z
          .record(z.string(), z.unknown())
          .optional()
          .refine(
            (fields) => {
              if (!fields) return true;
              return Object.keys(fields).length <= 50;
            },
            { message: 'Too many custom fields' },
          ),
        groups: z.array(objectIdValidation('group')).optional(),
        tags: z.array(z.string().min(1).max(50)).max(20, 'Maximum 20 tags allowed').optional(),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .refine(
            (metadata) => {
              if (!metadata) return true;
              return Object.keys(metadata).length <= 20;
            },
            { message: 'Too many metadata fields' },
          ),
      })
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field must be provided for update',
      }),
  }),

  /**
   * Customer group schemas
   */
  group: {
    create: z.object({
      body: z.object({
        name: z
          .string()
          .min(2, 'Group name must be at least 2 characters')
          .max(100, 'Group name is too long')
          .trim(),
        description: z.string().max(500, 'Description is too long').optional(),
        customFields: z.array(customFieldSchema).max(50, 'Too many custom fields').optional(),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .refine(
            (metadata) => {
              if (!metadata) return true;
              return Object.keys(metadata).length <= 20;
            },
            { message: 'Too many metadata fields' },
          ),
      }),
    }),

    update: z.object({
      params: z.object({
        id: objectIdValidation('group'),
      }),
      body: z.object({
        name: z
          .string()
          .min(2, 'Group name must be at least 2 characters')
          .max(100, 'Group name is too long')
          .trim()
          .optional(),
        description: z.string().max(500, 'Description is too long').optional(),
        customFields: z.array(customFieldSchema).max(50, 'Too many custom fields').optional(),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .refine(
            (metadata) => {
              if (!metadata) return true;
              return Object.keys(metadata).length <= 20;
            },
            { message: 'Too many metadata fields' },
          ),
      }),
    }),

    addCustomers: z.object({
      params: z.object({
        id: objectIdValidation('group'),
      }),
      body: z.object({
        customerIds: z.array(objectIdValidation('customer')).min(1).max(100),
      }),
    }),

    removeCustomers: z.object({
      params: z.object({
        id: objectIdValidation('group'),
      }),
      body: z.object({
        customerIds: z.array(objectIdValidation('customer')).min(1).max(100),
      }),
    }),
  },

  /**
   * Query parameter validations
   */
  query: {
    search: z.object({
      query: z.object({
        q: z.string().optional(),
        status: z.nativeEnum(CustomerStatus).optional(),
        groupId: objectIdValidation('group').optional(),
        assignedAdmin: objectIdValidation('admin').optional(),
        tags: z
          .string()
          .transform((val) => val.split(','))
          .optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        page: z.string().regex(/^\d+$/).transform(Number).optional(),
        limit: z.string().regex(/^\d+$/).transform(Number).optional(),
      }),
    }),

    statistics: z.object({
      query: z.object({
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
      }),
    }),

    list: z.object({
      query: z.object({
        page: z.string().regex(/^\d+$/).transform(Number).optional(),
        limit: z.string().regex(/^\d+$/).transform(Number).optional(),
        search: z.string().optional(),
      }),
    }),
  },
};
