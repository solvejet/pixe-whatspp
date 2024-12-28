// src/schemas/call.schema.ts

import { z } from 'zod';
import { Types } from 'mongoose';

/**
 * Helper function to validate MongoDB ObjectId
 */
const objectIdValidation = (fieldName: string): z.ZodEffects<z.ZodString, string, string> =>
  z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });

/**
 * Phone number validation regex - supports international format
 */
const phoneRegex = /^\+?[1-9]\d{1,14}$/;

export const callSchemas = {
  /**
   * Schema for initiating a call
   */
  initiateCall: z.object({
    body: z.object({
      customerId: objectIdValidation('customer'),
      phoneNumber: z
        .string()
        .regex(phoneRegex, 'Invalid phone number format. Must be in E.164 format')
        .min(8, 'Phone number must be at least 8 characters')
        .max(15, 'Phone number is too long'),
      customField: z.string().optional(),
      timeLimit: z
        .number()
        .min(60, 'Time limit must be at least 60 seconds')
        .max(14400, 'Time limit cannot exceed 4 hours')
        .optional(),
    }),
  }),

  /**
   * Schema for Exotel callback
   */
  callback: z.object({
    body: z.object({
      CallSid: z.string(),
      Status: z.string(),
      RecordingUrl: z.string().url().optional(),
      RecordingDuration: z.string().optional(),
      Direction: z.string(),
      From: z.string(),
      To: z.string(),
      DialCallStatus: z.string(),
      Price: z.string().optional(),
      Currency: z.string().optional(),
    }),
  }),

  /**
   * Schema for getting customer call history
   */
  getCustomerHistory: z.object({
    params: z.object({
      customerId: objectIdValidation('customer'),
    }),
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
   * Schema for getting staff call history
   */
  getStaffHistory: z.object({
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
   * Schema for getting call by ID
   */
  getCallById: z.object({
    params: z.object({
      id: objectIdValidation('call'),
    }),
  }),

  /**
   * Schema for getting call statistics
   */
  getStatistics: z.object({
    query: z.object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }),
  }),
};

// Export commonly used validation functions
export const validateCallParams = {
  phoneNumber: (number: string): boolean => phoneRegex.test(number),
  objectId: (id: string): boolean => Types.ObjectId.isValid(id),
  timeLimit: (limit: number): boolean => limit >= 60 && limit <= 14400,
};
