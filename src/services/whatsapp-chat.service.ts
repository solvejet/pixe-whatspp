// src/services/whatsapp-chat.service.ts

import { Types } from 'mongoose';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { whatsappMediaService } from '@/services/whatsapp-media.service.js';
import { customerService } from '@/services/customer.service.js';
import {
  ChatMessageModel,
  type IChatMessageDocument,
  type MessageContent,
} from '@/models/chat.model.js';
import { io, type WhatsAppMessageEvent, type WhatsAppStatusEvent } from '@/config/socket.js';
import type {
  WebhookMessage,
  ConversationInfo,
  PricingInfo,
  MessageType,
} from '@/types/whatsapp.chat.js';
import { CustomerStatus } from '@/types/customer.js';
import type { WhatsAppMediaType } from '@/types/whatsapp.media.js';

// Base interfaces
interface CustomerData {
  name: string;
  whatsappId: string;
  phoneNumber: string;
}

// Singleton service class
export class WhatsAppChatService {
  private static instance: WhatsAppChatService;
  private readonly countryCodeMap: Record<string, string> = {
    '1': 'US',
    '44': 'GB',
    '91': 'IN',
    // Add more mappings as needed
  };

  private constructor() {}

  public static getInstance(): WhatsAppChatService {
    if (!WhatsAppChatService.instance) {
      WhatsAppChatService.instance = new WhatsAppChatService();
    }
    return WhatsAppChatService.instance;
  }

  /**
   * Find customer by WhatsApp ID
   */
  public async findCustomerByWhatsAppId(whatsappId: string): Promise<{ id: string } | null> {
    try {
      return await customerService.findCustomerByWhatsAppId(whatsappId);
    } catch (error) {
      logger.error('Error finding customer by WhatsApp ID:', error);
      return null;
    }
  }

  /**
   * Create or retrieve customer
   */
  public async createCustomer(data: CustomerData): Promise<{ id: string }> {
    try {
      const existingCustomer = await customerService.findCustomerByWhatsAppId(data.whatsappId);
      if (existingCustomer) {
        return existingCustomer;
      }

      const customer = await customerService.createCustomer(
        {
          name: data.name,
          phoneNumber: data.phoneNumber,
          countryCode: this.extractCountryCode(data.phoneNumber),
          whatsappId: data.whatsappId,
          status: CustomerStatus.ACTIVE,
          assignedAdmin: (await this.getAvailableAdmin()).toString(),
        },
        'system',
      );

      return { id: customer.id };
    } catch (error) {
      logger.error('Error creating customer:', {
        error,
        whatsappId: data.whatsappId,
        phone: data.phoneNumber,
      });
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Failed to create customer', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          whatsappId: data.whatsappId,
        },
      });
    }
  }

  /**
   * Process text message
   */
  public async processTextMessage(
    message: WebhookMessage & { type: 'text' },
    customerId: string,
  ): Promise<void> {
    if (!message.text?.body) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing message body', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'text',
      content: { text: { body: message.text.body } }, // Match WhatsApp payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process media message with proper type handling
   */
  public async processMediaMessage(
    message: WebhookMessage & { type: 'image' | 'video' | 'audio' | 'document' },
    customerId: string,
  ): Promise<void> {
    const mediaType = message.type;
    const mediaContent = message[mediaType];

    if (!mediaContent?.id) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing media content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    try {
      // Download media from WhatsApp
      const mediaBuffer = await whatsappMediaService.downloadMedia(mediaContent.id);

      // Upload to our service and get permanent media ID
      const whatsAppMediaType = mediaType.toUpperCase() as WhatsAppMediaType;
      const permanentMediaId = await whatsappMediaService.uploadMedia({
        file: mediaBuffer,
        type: whatsAppMediaType,
        mimeType: mediaContent.mime_type ?? 'application/octet-stream',
        uploadedBy: new Types.ObjectId(customer.assignedAdmin.id),
        metadata: {
          originalName: mediaContent.filename,
          caption: mediaContent.caption,
          sha256: mediaContent.sha256,
        },
      });

      // Create message content based on media type
      const content = {
        [mediaType]: {
          id: permanentMediaId,
          caption: mediaContent.caption,
          mime_type: mediaContent.mime_type ?? 'application/octet-stream',
          sha256: mediaContent.sha256,
          ...(mediaType === 'document' && { filename: mediaContent.filename ?? 'untitled' }),
        },
      } as MessageContent;

      // Store message in database with clean metadata
      const metadata = new Map<string, unknown>();
      if (message.referral) {
        metadata.set('referral', message.referral);
      }

      const chatMessage = await ChatMessageModel.create({
        customerId: new Types.ObjectId(customerId),
        adminId: new Types.ObjectId(customer.assignedAdmin.id),
        whatsappMessageId: message.id,
        type: mediaType,
        content,
        status: 'delivered',
        direction: 'inbound',
        timestamp: new Date(parseInt(message.timestamp) * 1000),
        metadata,
      });

      await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
    } catch (error) {
      logger.error('Failed to process media message:', {
        messageId: message.id,
        mediaType,
        mediaId: mediaContent.id,
      });
      throw new AppError(
        ErrorCode.MESSAGE_HANDLING_ERROR,
        'Failed to process media message',
        500,
        false,
        {
          details: {
            originalError: error instanceof Error ? error.message : 'Unknown error',
            mediaType,
            mediaId: mediaContent.id,
          },
        },
      );
    }
  }

  /**
   * Process reaction message
   */
  public async processReactionMessage(
    message: WebhookMessage & { type: 'reaction' },
    customerId: string,
  ): Promise<void> {
    if (!message.reaction) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing reaction content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'reaction',
      content: { reaction: message.reaction }, // Match webhook payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process location message
   */
  public async processLocationMessage(
    message: WebhookMessage & { type: 'location' },
    customerId: string,
  ): Promise<void> {
    if (!message.location) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing location content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'location',
      content: { location: message.location }, // Match webhook payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process contact message
   */
  public async processContactMessage(
    message: WebhookMessage & { type: 'contacts' },
    customerId: string,
  ): Promise<void> {
    if (!message.contacts?.length) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing contacts content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'contacts',
      content: { contacts: message.contacts }, // Match webhook payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process interactive message
   */
  public async processInteractiveMessage(
    message: WebhookMessage & { type: 'interactive' },
    customerId: string,
  ): Promise<void> {
    if (!message.interactive?.type) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing interactive content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'interactive',
      content: { interactive: message.interactive }, // Match webhook payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process button message
   */
  public async processButtonMessage(
    message: WebhookMessage & { type: 'button' },
    customerId: string,
  ): Promise<void> {
    if (!message.button) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing button content', 400);
    }

    const customer = await customerService.getCustomerById(customerId);
    if (!customer) throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);

    const chatMessage = await ChatMessageModel.create({
      customerId: new Types.ObjectId(customerId),
      adminId: new Types.ObjectId(customer.assignedAdmin.id),
      whatsappMessageId: message.id,
      type: 'button',
      content: { button: message.button }, // Match webhook payload structure
      status: 'delivered',
      direction: 'inbound',
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: new Map(message.referral ? [['referral', message.referral]] : []),
    });

    await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
  }

  /**
   * Process referral message (from Click to WhatsApp ads)
   * @param message - Webhook message containing referral data
   * @param customerId - MongoDB ObjectId of the customer
   */
  public async processReferralMessage(message: WebhookMessage, customerId: string): Promise<void> {
    try {
      if (!message.referral) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Missing referral content in message',
          400,
          true,
          { details: { messageId: message.id } },
        );
      }

      const customer = await customerService.getCustomerById(customerId);
      if (!customer) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);
      }

      // Store the actual message with referral metadata
      const chatMessage = await ChatMessageModel.create({
        customerId: new Types.ObjectId(customerId),
        adminId: new Types.ObjectId(customer.assignedAdmin.id),
        whatsappMessageId: message.id,
        type: message.type,
        content: message.type === 'text' ? message.text?.body : message,
        status: 'delivered',
        direction: 'inbound',
        timestamp: new Date(parseInt(message.timestamp) * 1000),
        metadata: new Map([
          [
            'referral',
            {
              sourceUrl: message.referral.source_url,
              sourceId: message.referral.source_id,
              sourceType: message.referral.source_type,
              headline: message.referral.headline,
              body: message.referral.body,
              mediaType: message.referral.media_type,
              imageUrl: message.referral.image_url,
              videoUrl: message.referral.video_url,
              thumbnailUrl: message.referral.thumbnail_url,
              ctwaClid: message.referral.ctwa_clid,
            },
          ],
        ]),
      });

      await this.notifyMessageUpdate(customer.assignedAdmin.id, chatMessage, message);
    } catch (error) {
      logger.error('Error processing referral message:', {
        error,
        messageId: message.id,
        customerId,
      });
      throw error;
    }
  }

  /**
   * Update message status
   */
  public async updateMessageStatus(
    messageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    conversation?: ConversationInfo,
    pricing?: PricingInfo,
  ): Promise<void> {
    const message = await ChatMessageModel.findOne({ whatsappMessageId: messageId });
    if (!message) {
      logger.warn('Message not found for status update:', { messageId });
      return;
    }

    await message.updateMessageStatus(status);

    if (conversation || pricing) {
      const metadata = new Map(message.metadata);

      if (conversation) {
        metadata.set('conversation', conversation);
      }
      if (pricing) {
        metadata.set('pricing', pricing);
      }

      message.metadata = metadata;
      await message.save();
    }

    await this.notifyStatusUpdate(message, status, conversation, pricing);
  }

  /**
   * Notify message update through Socket.IO
   * @private
   */
  private async notifyMessageUpdate(
    adminId: string,
    chatMessage: IChatMessageDocument,
    originalMessage: WebhookMessage,
  ): Promise<void> {
    try {
      // Get message content with proper typing
      const messageContent = chatMessage.toObject();

      const messageData: WhatsAppMessageEvent = {
        messageId: chatMessage._id.toString(),
        recipientId: adminId,
        type: this.mapMessageType(chatMessage.type),
        content: {
          _id: messageContent._id.toString(),
          customerId: messageContent.customerId.toString(),
          adminId: messageContent.adminId.toString(),
          whatsappMessageId: messageContent.whatsappMessageId,
          type: messageContent.type,
          content: messageContent.content,
          metadata: this.convertMetadataToMap(messageContent.metadata),
          status: messageContent.status,
          direction: messageContent.direction,
          timestamp: messageContent.timestamp,
          conversationId: messageContent.conversationId,
          templateId: messageContent.templateId,
          useTemplate: messageContent.useTemplate ?? false,
          windowExpiresAt: messageContent.windowExpiresAt,
          referral: messageContent.referral,
        },
        timestamp: chatMessage.timestamp.getTime(),
        context: originalMessage.context,
        referral: originalMessage.referral,
        reaction: originalMessage.reaction,
      };

      await new Promise<void>((resolve, reject) => {
        try {
          io.to(`admin:${adminId}`).emit('whatsapp_message', messageData);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      logger.debug('Message notification sent:', {
        adminId,
        messageId: chatMessage._id,
        type: chatMessage.type,
        originalMessageId: originalMessage.id,
      });
    } catch (error) {
      logger.error('Failed to send message notification:', {
        error,
        adminId,
        messageId: chatMessage._id,
      });
      throw error;
    }
  }
  /**
   * Notify status update through Socket.IO
   */
  private async notifyStatusUpdate(
    message: IChatMessageDocument,
    status: IChatMessageDocument['status'],
    conversation: ConversationInfo | undefined,
    pricing: PricingInfo | undefined,
  ): Promise<void> {
    try {
      const baseData = {
        messageId: message._id.toString(),
        status,
        timestamp: Date.now(),
        recipientId: message.adminId.toString(),
      };

      const statusData: WhatsAppStatusEvent =
        status === 'failed'
          ? {
              ...baseData,
              error: {
                code: 'MESSAGE_DELIVERY_FAILED',
                message: 'Failed to deliver message',
              },
              conversation: conversation ?? null,
              pricing: pricing ?? null,
            }
          : {
              ...baseData,
              conversation: conversation ?? null,
              pricing: pricing ?? null,
              error: null,
            };

      await new Promise<void>((resolve, reject) => {
        try {
          io.to(`admin:${message.adminId.toString()}`).emit('whatsapp_status', statusData);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      logger.debug('Status notification sent:', {
        adminId: message.adminId,
        messageId: message._id,
        status,
        conversation,
        pricing,
      });
    } catch (error) {
      logger.error('Failed to send status notification:', {
        error,
        messageId: message._id,
        status,
      });
      throw error;
    }
  }

  /**
   * Extract country code
   */
  private extractCountryCode(phoneNumber: string): string {
    try {
      const matches = phoneNumber.match(/^\+(\d{1,3})/);
      if (!matches?.[1]) return 'IN';
      return this.countryCodeMap[matches[1]] ?? 'IN';
    } catch (error) {
      logger.warn('Error extracting country code:', { phoneNumber, error });
      return 'IN';
    }
  }

  /**
   * Convert metadata to Map
   * @private
   */
  private convertMetadataToMap(metadata: unknown): Map<string, unknown> {
    if (metadata instanceof Map) {
      return metadata;
    }
    if (metadata && typeof metadata === 'object') {
      return new Map(Object.entries(metadata));
    }
    return new Map();
  }

  /**
   * Map message type to WhatsApp message type
   * @private
   */
  private mapMessageType(type: string): MessageType {
    const validTypes: MessageType[] = [
      'text',
      'image',
      'video',
      'audio',
      'document',
      'location',
      'contacts',
      'interactive',
      'button',
      'reaction',
      'template',
    ];

    return validTypes.includes(type as MessageType) ? (type as MessageType) : 'unknown';
  }

  /**
   * Get available admin
   */
  private async getAvailableAdmin(): Promise<Types.ObjectId> {
    return await customerService.getDefaultAdmin();
  }
}

export const whatsappChatService = WhatsAppChatService.getInstance();
