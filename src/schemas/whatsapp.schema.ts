// src/schemas/whatsapp.schema.ts

import { z } from 'zod';
import { Types } from 'mongoose';
import { MessageType, MessageStatus, ConversationType } from '@/types/whatsapp.js';

/**
 * Helper function to validate MongoDB ObjectId
 */
const objectIdValidation = (fieldName: string): z.ZodEffects<z.ZodString, string, string> => {
  return z.string().refine((val) => Types.ObjectId.isValid(val), {
    message: `Invalid ${fieldName} ID format`,
  });
};

/**
 * Common message content validation
 */
const messageContentSchema = z.record(z.unknown()).refine(
  (content) => {
    if (!content || Object.keys(content).length === 0) {
      return false;
    }
    return true;
  },
  { message: 'Message content cannot be empty' },
);

/**
 * Variables validation
 */
const variableSchema = z
  .record(
    z.object({
      value: z.unknown(),
      source: z.enum(['customer', 'custom_field', 'static']),
      type: z.enum(['text', 'image', 'document', 'video']),
    }),
  )
  .optional();

export const whatsappSchemas = {
  /**
   * Webhook verification schema
   */
  webhookVerification: z.object({
    query: z.object({
      'hub.mode': z.string(),
      'hub.verify_token': z.string(),
      'hub.challenge': z.string(),
    }),
  }),

  /**
   * Webhook payload schema
   */
  webhook: z.object({
    body: z.object({
      object: z.literal('whatsapp_business_account'),
      entry: z.array(
        z.object({
          id: z.string(),
          changes: z.array(
            z.object({
              value: z.object({
                messaging_product: z.literal('whatsapp'),
                metadata: z.object({
                  display_phone_number: z.string(),
                  phone_number_id: z.string(),
                }),
                messages: z.array(z.unknown()).optional(),
                statuses: z.array(z.unknown()).optional(),
              }),
              field: z.string(),
            }),
          ),
        }),
      ),
    }),
  }),

  /**
   * Send message schema
   */
  sendMessage: z.object({
    body: z.object({
      to: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
      type: z.nativeEnum(MessageType),
      content: messageContentSchema,
      variables: variableSchema,
    }),
  }),

  /**
   * Send template message schema
   */
  sendTemplate: z.object({
    body: z.object({
      to: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
      templateName: z.string().min(1, 'Template name is required'),
      language: z.string().length(2, 'Language code must be 2 characters'),
      variables: variableSchema,
    }),
  }),

  /**
   * Send bulk messages schema
   */
  sendBulkMessages: z.object({
    body: z.object({
      messages: z
        .array(
          z.object({
            to: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
            type: z.nativeEnum(MessageType),
            content: messageContentSchema,
            variables: variableSchema,
          }),
        )
        .min(1, 'At least one message is required')
        .max(100, 'Maximum 100 messages allowed in bulk send'),
    }),
  }),

  /**
   * List conversations schema
   */
  listConversations: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 1)),
      limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 20)),
      status: z.enum(['active', 'expired', 'closed']).optional(),
      type: z.nativeEnum(ConversationType).optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }),
  }),

  /**
   * Get conversation history schema
   */
  getConversationHistory: z.object({
    params: z.object({
      id: objectIdValidation('conversation'),
    }),
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 1)),
      limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 50)),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      status: z.nativeEnum(MessageStatus).optional(),
    }),
  }),

  /**
   * Mark messages as read schema
   */
  markMessagesRead: z.object({
    params: z.object({
      id: objectIdValidation('conversation'),
    }),
    body: z.object({
      messageIds: z
        .array(z.string())
        .min(1, 'At least one message ID is required')
        .max(100, 'Maximum 100 messages can be marked as read at once'),
    }),
  }),

  /**
   * List assigned customers schema
   */
  listAssignedCustomers: z.object({
    query: z.object({
      page: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 1)),
      limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 20)),
      search: z.string().optional(),
      status: z.enum(['active', 'inactive', 'blocked']).optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      sortBy: z.enum(['name', 'createdAt', 'lastActivity']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  }),

  /**
   * Message status update schema
   */
  messageStatus: z.object({
    params: z.object({
      id: objectIdValidation('message'),
    }),
    body: z.object({
      status: z.nativeEnum(MessageStatus),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.unknown()).optional(),
        })
        .optional(),
    }),
  }),
};
