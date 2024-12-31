// src/services/whatsapp.service.ts

import { Types } from 'mongoose';
import { env } from '@/config/env.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { ConversationModel, MessageModel, TemplateModel } from '@/models/whatsapp.model.js';
import { mediaService } from '@/services/media.service.js';
import type { MulterFile } from '@/types/media.js';
import type { Channel } from 'amqplib';
import type { Server as SocketServer } from 'socket.io';
import { MessageType, MessageStatus, ConversationType, type IMessage } from '@/types/whatsapp.js';
import {
  isInteractiveMessage,
  isMediaMessage,
  isReferralMessage,
  isTemplateMessage,
  type WhatsAppWebhookPayload,
  type WhatsAppWebhookMessage,
  type WhatsAppWebhookStatus,
  type WhatsAppWebhookMedia,
  type WhatsAppWebhookTextMessage,
  type WhatsAppWebhookImageMessage,
  type WhatsAppWebhookVideoMessage,
  type WhatsAppWebhookAudioMessage,
  type WhatsAppWebhookDocumentMessage,
  type WhatsAppWebhookLocationMessage,
  type WhatsAppWebhookInteractiveMessage,
  type WhatsAppWebhookReferralMessage,
  type WhatsAppWebhookTemplateMessage,
  type WhatsAppWebhookErrorMessage,
  isTextMessage,
} from '@/types/whatsapp-webhook.js';
import type { VariableMap, ITemplate } from '@/types/whatsapp.js';
import { UserModel } from '@/models/user.model.js';
import { FailedMessageModel } from '@/models/failed-message.model.js';
import { NotificationModel } from '@/models/notification.model.js';
import { Redis } from '@/config/redis.js';
import { ReferralModel } from '@/models/referral.model.js';

interface QueuedMessage {
  to: string;
  type: MessageType;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  variables?: VariableMap;
  timestamp: number;
  retryCount?: number;
}

interface ReferralMetrics {
  totalClicks: number;
  uniqueUsers: number;
  conversions: number;
  source: string;
  campaign?: string;
}

interface FailedMessageRecord {
  _id: Types.ObjectId;
  messageId?: string;
  to: string;
  type: MessageType;
  content: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  retryCount: number;
  lastRetryAt?: Date;
  createdAt: Date;
  status: 'pending_retry' | 'failed' | 'resolved';
  metadata?: Record<string, unknown>;
}

interface StoredMessage {
  messageId: string;
  from: string;
  to: string;
  conversationId: Types.ObjectId;
  type: MessageType;
  content: Record<string, unknown>;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export class WhatsAppService {
  private static instance: WhatsAppService;

  // Constants
  private readonly QUEUE_NAME = 'whatsapp_messages';
  private readonly DLQ_NAME = 'whatsapp_messages_dlq';
  private readonly CONVERSATION_PREFIX = 'whatsapp:conversation:';
  private readonly MESSAGE_PREFIX = 'whatsapp:message:';
  private readonly VARIABLE_REGEX = /{{([^{}]+)}}/g;

  // Configuration
  private readonly MAX_RETRIES = 3;
  private readonly MAX_RETRY_DELAY = 1000 * 60 * 60;
  private readonly RETRY_DELAY = 5000; // 5 seconds
  private readonly BATCH_SIZE = 10;
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly RATE_LIMIT = {
    MAX_REQUESTS: 100,
    WINDOW_MS: 60000, // 1 minute
  };

  // Service state
  private socketServer: SocketServer | null = null;
  private channel: Channel | null = null;
  private isProcessing = false;
  private readonly rateLimiter = new Map<string, { count: number; resetTime: number }>();

  private constructor() {
    void this.initialize();
  }

  public static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  public setSocketServer(server: SocketServer): void {
    this.socketServer = server;
  }

  /**
   * Initialize service
   */
  private async initialize(): Promise<void> {
    try {
      // Initialize RabbitMQ channel
      this.channel = await RabbitMQ.createChannel('whatsapp_service');

      // Setup main queue
      await RabbitMQ.assertQueue(this.channel, this.QUEUE_NAME, {
        durable: true,
        deadLetterExchange: 'dlx',
        deadLetterRoutingKey: 'dlq.whatsapp_messages',
        messageTtl: 24 * 60 * 60 * 1000, // 24 hours
      });

      // Setup DLQ
      await RabbitMQ.assertQueue(this.channel, this.DLQ_NAME, {
        durable: true,
      });

      // Start message processors
      void this.startMessageConsumer();
      void this.startDLQConsumer();

      // Setup cleanup interval
      setInterval(() => void this.cleanupExpiredConversations(), 60 * 60 * 1000); // Every hour

      logger.info('WhatsApp service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WhatsApp service:', error);
      throw error;
    }
  }

  /**
   * Webhook Handler
   */
  public async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    try {
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          const { value } = change;

          await Promise.all(
            [
              // Process messages
              value.messages?.map((message) =>
                this.processIncomingMessage(message, value.metadata.phone_number_id),
              ),
              // Process status updates
              value.statuses?.map((status) => this.handleMessageStatus(status)),
            ].filter(Boolean),
          );
        }
      }
    } catch (error) {
      logger.error('Error handling webhook:', error);
      throw error;
    }
  }

  /**
   * Message Processing
   */
  private async processIncomingMessage(
    message: WhatsAppWebhookMessage,
    phoneNumberId: string,
  ): Promise<void> {
    try {
      // Get or create conversation
      const conversation = await this.getOrCreateConversation(
        message.from,
        phoneNumberId,
        ConversationType.CUSTOMER_INITIATED,
      );

      // Process based on message type
      if (isTextMessage(message)) {
        await this.handleTextMessage(message, phoneNumberId, conversation._id);
      } else if (isMediaMessage(message)) {
        await this.handleMediaMessage(message, phoneNumberId, conversation._id);
      } else if (isInteractiveMessage(message)) {
        await this.handleInteractiveMessage(message, phoneNumberId, conversation._id);
      } else if (isReferralMessage(message)) {
        await this.handleReferralMessage(message, phoneNumberId, conversation._id);
      } else if (isTemplateMessage(message)) {
        await this.handleTemplateMessage(message, phoneNumberId, conversation._id);
      } else if ('location' in message) {
        await this.handleLocationMessage(
          message as WhatsAppWebhookLocationMessage,
          phoneNumberId,
          conversation._id,
        );
        return;
      } else {
        await this.handleUnknownMessage(
          message as WhatsAppWebhookErrorMessage,
          phoneNumberId,
          conversation._id,
        );
      }

      // Update conversation last activity
      await this.updateConversationActivity(conversation._id);

      // Process automated responses
      void this.processAutomatedResponse(message);
    } catch (error) {
      logger.error('Error processing incoming message:', error);
      throw error;
    }
  }

  /**
   * Message Type Handlers
   */
  private async handleTextMessage(
    message: WhatsAppWebhookTextMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.TEXT,
      content: {
        text: message.text.body,
        previewUrl: message.text.preview_url,
      },
      timestamp: message.timestamp,
      metadata: {
        context: message.context,
      },
    });
  }

  private async handleMediaMessage(
    message:
      | WhatsAppWebhookImageMessage
      | WhatsAppWebhookVideoMessage
      | WhatsAppWebhookAudioMessage
      | WhatsAppWebhookDocumentMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    const mediaType = message.type;
    const media = message[mediaType.toLowerCase() as keyof typeof message] as WhatsAppWebhookMedia;

    if (!media?.id) {
      logger.warn('Media message received without media ID:', message);
      return;
    }

    try {
      // Download media with retries
      const mediaBuffer = await this.downloadMediaWithRetries(media.id);

      // Create file object for media service
      const file: MulterFile = {
        fieldname: mediaType.toLowerCase(),
        originalname: `${message.id}.${media.mime_type?.split('/')[1] || 'bin'}`,
        encoding: '7bit',
        mimetype: media.mime_type || 'application/octet-stream',
        size: media.file_size || mediaBuffer.length,
        buffer: mediaBuffer,
      };

      // Store media
      const storedMedia = await mediaService.uploadMedia(file, 'system');

      // Store message
      await this.storeMessage({
        messageId: message.id,
        from: message.from,
        to: phoneNumberId,
        conversationId,
        type: mediaType,
        content: {
          mediaId: storedMedia.id,
          caption: media.caption,
          mimeType: media.mime_type,
          sha256: media.sha256,
          url: storedMedia.url,
        },
        timestamp: message.timestamp,
        metadata: {
          mediaInfo: media,
          context: message.context,
        },
      });
    } catch (error) {
      logger.error(`Error handling ${mediaType} message:`, error);
      throw error;
    }
  }

  private async downloadMediaWithRetries(mediaId: string): Promise<Buffer> {
    let retries = 0;
    let lastError: Error | null = null;

    while (retries < this.MAX_RETRIES) {
      try {
        return await this.downloadMedia(mediaId);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        retries++;
        if (retries === this.MAX_RETRIES) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.RETRY_DELAY * Math.pow(2, retries - 1)),
        );
      }
    }

    throw lastError || new Error('Failed to download media after retries');
  }

  private async downloadMedia(mediaId: string): Promise<Buffer> {
    const cacheKey = `${this.MESSAGE_PREFIX}media:${mediaId}`;

    try {
      let mediaInfo: { url: string };

      // Check cache
      const cachedInfo = await Redis.get(cacheKey);
      if (cachedInfo) {
        mediaInfo = JSON.parse(cachedInfo);
      } else {
        // Get media URL
        const mediaInfoResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          },
        });

        if (!mediaInfoResponse.ok) {
          throw new AppError(
            ErrorCode.EXTERNAL_API_ERROR,
            'Failed to get media info',
            mediaInfoResponse.status,
          );
        }

        mediaInfo = await mediaInfoResponse.json();

        // Cache media info
        await Redis.setEx(cacheKey, this.CACHE_TTL, JSON.stringify(mediaInfo));
      }

      // Download media
      const mediaResponse = await fetch(mediaInfo.url, {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        },
      });

      if (!mediaResponse.ok) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to download media',
          mediaResponse.status,
        );
      }

      return Buffer.from(await mediaResponse.arrayBuffer());
    } catch (error) {
      logger.error('Error downloading media:', error);
      throw error;
    }
  }

  private async handleInteractiveMessage(
    message: WhatsAppWebhookInteractiveMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    const { interactive } = message;

    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.INTERACTIVE,
      content: {
        type: interactive.type,
        ...(interactive.list_reply && { listReply: interactive.list_reply }),
        ...(interactive.button_reply && { buttonReply: interactive.button_reply }),
      },
      timestamp: message.timestamp,
      metadata: {
        context: message.context,
      },
    });
  }

  private async handleLocationMessage(
    message: WhatsAppWebhookLocationMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    const locationData: Record<string, unknown> = {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      name: message.location.name,
      address: message.location.address,
    };

    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.LOCATION,
      content: locationData,
      timestamp: message.timestamp,
      metadata: {
        context: message.context,
      },
    });
  }

  private async handleReferralMessage(
    message: WhatsAppWebhookReferralMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.TEXT,
      content: {
        text: message.text.body,
        referral: message.referral,
      },
      timestamp: message.timestamp,
      metadata: {
        referral: message.referral,
        context: message.context,
      },
    });

    // Track referral data
    void this.trackReferral(message.from, message.referral);
  }

  private async handleTemplateMessage(
    message: WhatsAppWebhookTemplateMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.TEMPLATE,
      content: {
        name: message.template.name,
        language: message.template.language,
        components: message.template.components,
      },
      timestamp: message.timestamp,
      metadata: {
        context: message.context,
      },
    });
  }

  private async handleUnknownMessage(
    message: WhatsAppWebhookErrorMessage,
    phoneNumberId: string,
    conversationId: Types.ObjectId,
  ): Promise<void> {
    await this.storeMessage({
      messageId: message.id,
      from: message.from,
      to: phoneNumberId,
      conversationId,
      type: MessageType.UNKNOWN,
      content: {
        errors: message.errors,
      },
      timestamp: message.timestamp,
      metadata: {
        context: message.context,
      },
    });

    // Log error for monitoring
    logger.error('Received unknown message type:', {
      messageId: message.id,
      errors: message.errors,
    });
  }

  /**
   * Message Status Handler
   */
  private async handleMessageStatus(status: WhatsAppWebhookStatus): Promise<void> {
    try {
      const message = await MessageModel.findOne({ messageId: status.id });
      if (!message) {
        logger.warn('Message not found for status update:', status);
        return;
      }

      // Update status
      message.status = status.status as MessageStatus;
      message.metadata.set('status', {
        timestamp: status.timestamp,
        errors: status.errors,
        pricing: status.pricing,
        conversation: status.conversation,
      });

      await message.save();

      // Emit status update
      this.emitMessageStatus(message.conversationId.toString(), {
        messageId: status.id,
        status: status.status,
        timestamp: status.timestamp,
        errors: status.errors,
      });

      // Handle failed messages
      if (status.status === MessageStatus.FAILED && status.errors) {
        await this.handleFailedMessage(message, status.errors);
      }
    } catch (error) {
      logger.error('Error handling message status:', error);
      throw error;
    }
  }

  /**
   * Queue Processing
   */
  private async processOutgoingMessage(message: QueuedMessage): Promise<void> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: message.to,
            type: message.type,
            [message.type]: message.content,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to send WhatsApp message',
          response.status,
          false,
          { details: error },
        );
      }

      const result = await response.json();

      // Get or create conversation
      const conversation = await this.getOrCreateConversation(
        message.to,
        env.WHATSAPP_PHONE_NUMBER_ID,
        ConversationType.BUSINESS_INITIATED,
      );

      // Store sent message
      await this.storeMessage({
        messageId: result.messages[0].id,
        from: env.WHATSAPP_PHONE_NUMBER_ID,
        to: message.to,
        conversationId: conversation._id,
        type: message.type,
        content: message.content,
        timestamp: (Date.now() / 1000).toString(),
        metadata: message.metadata,
      });
    } catch (error) {
      logger.error('Error processing outgoing message:', error);

      if (this.isRetryableError(error)) {
        throw new Error('retry');
      }
      throw error;
    }
  }

  private async startMessageConsumer(): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    try {
      await this.channel.prefetch(this.BATCH_SIZE);

      await this.channel.consume(
        this.QUEUE_NAME,
        async (msg) => {
          if (!msg || this.isProcessing) return;

          try {
            this.isProcessing = true;
            const messages: QueuedMessage[] = [JSON.parse(msg.content.toString())];

            // Collect batch messages
            const additionalMsgs = await this.collectBatchMessages();
            messages.push(...additionalMsgs);

            // Process messages in parallel with rate limiting
            await Promise.all(
              messages.map((message) => this.processOutgoingMessageWithRateLimit(message)),
            );

            this.channel?.ack(msg);
          } catch (error) {
            logger.error('Error processing message batch:', error);

            const message = JSON.parse(msg.content.toString()) as QueuedMessage;
            if ((message.retryCount || 0) < this.MAX_RETRIES) {
              void this.requeueWithDelay(message);
              this.channel?.ack(msg);
            } else {
              this.channel?.nack(msg, false, false); // Send to DLQ
            }
          } finally {
            this.isProcessing = false;
          }
        },
        { noAck: false },
      );
    } catch (error) {
      logger.error('Error starting message consumer:', error);
      throw error;
    }
  }

  private async startDLQConsumer(): Promise<void> {
    if (!this.channel) return;

    try {
      await this.channel.consume(
        this.DLQ_NAME,
        async (msg) => {
          if (!msg) return;

          try {
            const queuedMessage = JSON.parse(msg.content.toString()) as QueuedMessage;

            // Convert QueuedMessage to FailedMessageRecord
            const failedMessage: FailedMessageRecord = {
              _id: new Types.ObjectId(),
              messageId: undefined, // Original queued message doesn't have messageId
              to: queuedMessage.to,
              type: queuedMessage.type,
              content: queuedMessage.content,
              error: {
                code: 'QUEUE_PROCESSING_ERROR',
                message: 'Message exceeded retry attempts',
                details: {
                  retryCount: queuedMessage.retryCount,
                  timestamp: queuedMessage.timestamp,
                },
              },
              retryCount: queuedMessage.retryCount || 0,
              createdAt: new Date(),
              status: 'failed',
              metadata: {
                originalMessage: queuedMessage,
                processingHistory: {
                  queuedAt: new Date(queuedMessage.timestamp),
                  lastRetryAt: new Date(),
                },
              },
            };

            // Store failed message
            await this.storeFailedMessage(failedMessage);
            this.channel?.ack(msg);
          } catch (error) {
            logger.error('Error processing DLQ message:', error);
            this.channel?.nack(msg, false, false);
          }
        },
        { noAck: false },
      );
    } catch (error) {
      logger.error('Error setting up DLQ consumer:', error);
    }
  }

  /**
   * Rate Limiting
   */
  private async processOutgoingMessageWithRateLimit(message: QueuedMessage): Promise<void> {
    const now = Date.now();
    const limiter = this.rateLimiter.get(message.to) || {
      count: 0,
      resetTime: now + this.RATE_LIMIT.WINDOW_MS,
    };

    if (now > limiter.resetTime) {
      limiter.count = 0;
      limiter.resetTime = now + this.RATE_LIMIT.WINDOW_MS;
    }

    if (limiter.count >= this.RATE_LIMIT.MAX_REQUESTS) {
      const delay = limiter.resetTime - now;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.processOutgoingMessageWithRateLimit(message);
    }

    limiter.count++;
    this.rateLimiter.set(message.to, limiter);

    await this.processOutgoingMessage(message);
  }

  /**
   * Message Storage
   */
  private async storeMessage(messageData: StoredMessage): Promise<void> {
    try {
      const message = await MessageModel.create({
        conversationId: messageData.conversationId,
        messageId: messageData.messageId,
        from: messageData.from,
        to: messageData.to,
        type: messageData.type,
        status: MessageStatus.DELIVERED,
        timestamp: new Date(Number(messageData.timestamp) * 1000),
        content: {
          type: messageData.type,
          data: messageData.content,
        },
        metadata: new Map(Object.entries(messageData.metadata || {})),
      });

      // Emit new message event
      this.emitNewMessage(messageData.conversationId.toString(), message);
    } catch (error) {
      logger.error('Error storing message:', error);
      throw error;
    }
  }

  /**
   * Store failed message for tracking and retry
   */
  private async storeFailedMessage(message: FailedMessageRecord): Promise<void> {
    try {
      // Store in MongoDB for persistence
      await FailedMessageModel.create(message);

      // Store in Redis for quick access and retry tracking
      const redisKey = `failed_message:${message._id.toString()}`;
      await Redis.hSet(redisKey, {
        messageId: message.messageId || '',
        to: message.to,
        type: message.type,
        status: message.status,
        retryCount: message.retryCount.toString(),
        error: JSON.stringify(message.error),
        createdAt: message.createdAt.toISOString(),
      });

      // Set expiry for Redis entry
      await Redis.setExpiry(redisKey, 7 * 24 * 60 * 60); // 7 days

      // Update metrics
      await this.updateFailureMetrics(message);

      logger.info('Failed message stored:', {
        messageId: message.messageId,
        status: message.status,
      });
    } catch (error) {
      logger.error('Error storing failed message:', error);
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Failed to store failed message', 500, false, {
        details: {
          messageId: message.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Variable Processing
   */
  private async processVariables(
    content: Record<string, unknown>,
    variables: VariableMap,
  ): Promise<Record<string, unknown>> {
    const processedContent = { ...content };

    for (const [key, value] of Object.entries(processedContent)) {
      if (typeof value === 'string') {
        processedContent[key] = await this.replaceVariables(value, variables);
      } else if (typeof value === 'object' && value !== null) {
        processedContent[key] = await this.processVariables(
          value as Record<string, unknown>,
          variables,
        );
      }
    }

    return processedContent;
  }

  private async replaceVariables(text: string, variables: VariableMap): Promise<string> {
    return text.replace(this.VARIABLE_REGEX, (match, key) => {
      const variable = variables[key.trim()];
      if (!variable) {
        logger.warn(`Variable ${key} not found`);
        return match;
      }
      return String(variable.value);
    });
  }

  /**
   * Conversation Management
   */
  private async getOrCreateConversation(
    from: string,
    to: string,
    type: ConversationType,
  ): Promise<{ _id: Types.ObjectId; expiresAt: Date }> {
    const cacheKey = `${this.CONVERSATION_PREFIX}${from}:${to}`;

    try {
      // Check cache
      const cached = await Redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as { _id: Types.ObjectId; expiresAt: Date };
      }

      // Find or create conversation
      const conversation = await ConversationModel.findOneAndUpdate(
        {
          customerId: from,
          businessId: to,
          status: 'active',
        },
        {
          $setOnInsert: {
            type,
            lastMessageAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        },
        {
          new: true,
          upsert: true,
        },
      );

      // Cache the result
      await Redis.setEx(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify({
          _id: conversation._id,
          expiresAt: conversation.expiresAt,
        }),
      );

      return {
        _id: conversation._id,
        expiresAt: conversation.expiresAt,
      };
    } catch (error) {
      logger.error('Error getting/creating conversation:', error);
      throw error;
    }
  }

  private async updateConversationActivity(conversationId: Types.ObjectId): Promise<void> {
    await ConversationModel.updateOne(
      { _id: conversationId },
      {
        $set: {
          lastMessageAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      },
    );
  }

  /**
   * Helper methods for failed message handling
   */
  private isCriticalError(error: { code: string; message: string }): boolean {
    const criticalCodes = ['AUTH_FAILED', 'ACCOUNT_BLOCKED', 'API_VERSION_INVALID'];
    return criticalCodes.includes(error.code);
  }

  private async notifyAdmins(message: FailedMessageRecord): Promise<void> {
    try {
      // Get admin notification settings
      const admins = await UserModel.find({
        roles: 'admin',
        'settings.notifications.errors': true,
      });

      // Send notifications
      const notifications = admins.map((admin) => ({
        userId: admin._id,
        type: 'error',
        title: 'Critical WhatsApp Error',
        message: `Message ${message.messageId} failed: ${message.error.message}`,
        data: {
          messageId: message.messageId,
          error: message.error,
        },
        priority: 'high',
      }));

      await NotificationModel.insertMany(notifications);

      // Send real-time notifications if admins are online
      if (this.socketServer) {
        admins.forEach((admin) => {
          this.socketServer?.to(`user:${admin._id}`).emit('critical_error', {
            messageId: message.messageId,
            error: message.error,
            timestamp: Date.now(),
          });
        });
      }
    } catch (error) {
      logger.error('Error notifying admins:', error);
    }
  }

  private shouldRetryMessage(message: FailedMessageRecord): boolean {
    // Don't retry if max attempts reached
    if (message.retryCount >= this.MAX_RETRIES) return false;

    // Don't retry certain error types
    const nonRetryableCodes = ['INVALID_RECIPIENT', 'BLOCKED_RECIPIENT', 'INVALID_MESSAGE_FORMAT'];
    if (nonRetryableCodes.includes(message.error.code)) return false;

    return true;
  }

  private async scheduleMessageRetry(message: FailedMessageRecord): Promise<void> {
    try {
      // Calculate delay using exponential backoff
      const delayMs = Math.min(
        this.RETRY_DELAY * Math.pow(2, message.retryCount),
        this.MAX_RETRY_DELAY,
      );

      // Schedule retry
      setTimeout(async () => {
        try {
          await this.retryMessage(message);
        } catch (error) {
          logger.error('Error retrying message:', error);
        }
      }, delayMs);

      // Update retry tracking
      await FailedMessageModel.updateOne(
        { _id: message._id },
        {
          $inc: { retryCount: 1 },
          $set: { lastRetryAt: new Date() },
        },
      );

      logger.info('Message retry scheduled:', {
        messageId: message.messageId,
        retryCount: message.retryCount + 1,
        delayMs,
      });
    } catch (error) {
      logger.error('Error scheduling message retry:', error);
    }
  }

  // Implement retryMessage method
  private async retryMessage(message: FailedMessageRecord): Promise<void> {
    try {
      // Attempt to send the message again
      await this.sendMessage(
        message.to,
        message.type,
        message.content,
        undefined,
        message.retryCount + 1,
      );

      // Update message status to resolved if successful
      await FailedMessageModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: 'resolved',
            'metadata.resolvedAt': new Date(),
          },
        },
      );

      logger.info('Message retry successful:', {
        messageId: message.messageId,
        retryCount: message.retryCount + 1,
      });
    } catch (error) {
      logger.error('Message retry failed:', error);

      // Update retry count and check if max retries reached
      const updatedMessage = await FailedMessageModel.findByIdAndUpdate(
        message._id,
        {
          $inc: { retryCount: 1 },
          $set: {
            lastRetryAt: new Date(),
            status: message.retryCount + 1 >= this.MAX_RETRIES ? 'failed' : 'pending_retry',
            'metadata.lastError': error instanceof Error ? error.message : 'Unknown error',
          },
        },
        { new: true },
      );

      if (updatedMessage && this.shouldRetryMessage(updatedMessage)) {
        await this.scheduleMessageRetry(updatedMessage);
      }
    }
  }

  private async updateFailureMetrics(message: FailedMessageRecord): Promise<void> {
    try {
      const baseKey = 'metrics:failures';
      const hourKey = `${baseKey}:hourly:${new Date().toISOString().slice(0, 13)}`;

      // Use type-safe command array
      const commands: Array<[string, ...unknown[]]> = [
        ['hincrby', `${baseKey}:total`, message.error.code, 1],
        ['hincrby', hourKey, message.error.code, 1],
        ['expire', hourKey, 7 * 24 * 60 * 60], // 7 days retention
        ['hincrby', `${baseKey}:recipients:${message.to}`, 'total', 1],
      ];

      await Redis.executeMulti(commands);

      // Update error tracking separately
      const errorKey = `${baseKey}:errors:${message.error.code}`;
      await Redis.hSet(errorKey, {
        lastOccurred: new Date().toISOString(),
        count: (await Redis.hIncrBy(errorKey, 'count', 1)).toString(),
      });
    } catch (error) {
      logger.error('Error updating failure metrics:', {
        error,
        messageId: message.messageId,
        errorCode: message.error.code,
      });
    }
  }

  private async cleanupExpiredConversations(): Promise<void> {
    try {
      const result = await ConversationModel.updateMany(
        {
          status: 'active',
          expiresAt: { $lte: new Date() },
        },
        {
          $set: { status: 'expired' },
        },
      );

      logger.info(`Expired ${result.modifiedCount} conversations`);

      // Clear related caches
      if (result.modifiedCount > 0) {
        const keys = await Redis.keys(`${this.CONVERSATION_PREFIX}*`);
        if (keys.length) {
          await Redis.deleteMany(keys);
        }
      }
    } catch (error) {
      logger.error('Error cleaning up expired conversations:', error);
    }
  }

  /**
   * Event Emitters
   */
  private emitNewMessage(conversationId: string, message: unknown): void {
    if (this.socketServer) {
      this.socketServer.to(`conversation:${conversationId}`).emit('new_message', message);
    }
  }

  private emitMessageStatus(conversationId: string, status: unknown): void {
    if (this.socketServer) {
      this.socketServer.to(`conversation:${conversationId}`).emit('message_status', status);
    }
  }

  /**
   * Utility Methods
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof AppError) {
      const retryableCodes = [429, 502, 503, 504];
      return retryableCodes.includes(error.statusCode);
    }
    return false;
  }

  private async requeueWithDelay(message: QueuedMessage): Promise<void> {
    const retryCount = (message.retryCount || 0) + 1;
    const delay = this.RETRY_DELAY * Math.pow(2, retryCount - 1);

    setTimeout(async () => {
      try {
        await this.sendMessage(
          message.to,
          message.type,
          message.content,
          message.variables,
          retryCount,
        );
      } catch (error) {
        logger.error('Error requeueing message:', error);
      }
    }, delay);
  }

  /**
   * Track referral data for analytics and attribution
   */
  private async trackReferral(userId: string, referral: unknown): Promise<void> {
    try {
      const referralData = referral as {
        source_url?: string;
        source_id?: string;
        source_type?: string;
        headline?: string;
        body?: string;
        media_type?: string;
        ctwa_clid?: string;
      };

      // Create metrics object
      const metrics: ReferralMetrics = {
        totalClicks: 1,
        uniqueUsers: 1,
        conversions: 0,
        source: referralData.source_type || 'unknown',
        campaign: referralData.ctwa_clid,
      };

      // Store in Redis for real-time tracking
      const referralKey = `referral:${referralData.source_id || 'unknown'}`;
      await Redis.hIncrBy(referralKey, 'uniqueUsers', 1);

      // Track unique users
      const userKey = `referral:users:${referralData.source_id}`;
      const isNewUser = await Redis.sAdd(userKey, userId);
      if (isNewUser) {
        await Redis.hIncrBy(referralKey, 'uniqueUsers', 1);
      }

      // Store detailed referral data in MongoDB
      await ReferralModel.create({
        userId: new Types.ObjectId(userId),
        sourceUrl: referralData.source_url,
        sourceId: referralData.source_id,
        sourceType: referralData.source_type,
        headline: referralData.headline,
        body: referralData.body,
        mediaType: referralData.media_type,
        campaignId: referralData.ctwa_clid,
        metrics,
        metadata: {
          raw: referralData,
          processedAt: new Date(),
        },
      });

      // Emit event for real-time analytics
      if (this.socketServer) {
        this.socketServer.emit('referral_tracked', {
          userId,
          source: referralData.source_type,
          campaign: referralData.ctwa_clid,
          timestamp: Date.now(),
        });
      }

      logger.info('Referral tracked successfully:', {
        userId,
        sourceType: referralData.source_type,
        campaignId: referralData.ctwa_clid,
      });
    } catch (error) {
      logger.error('Error tracking referral:', error);
      // Don't throw - we don't want to break message processing for tracking errors
    }
  }

  private async processAutomatedResponse(message: WhatsAppWebhookMessage): Promise<void> {
    // Implement automation logic
    // This will be connected to the automation builder
  }

  /**
   * Handle failed message with proper error tracking and retry logic
   */
  private async handleFailedMessage(message: IMessage, errors: unknown[]): Promise<void> {
    try {
      // Extract error details
      const errorDetails = errors.map((error) => {
        if (error instanceof Error) {
          return {
            code: 'ERROR',
            message: error.message,
            details: { stack: error.stack },
          };
        }
        return {
          code: 'UNKNOWN_ERROR',
          message: String(error),
          details: { raw: error },
        };
      });

      // Create failed message record
      const failedMessage: FailedMessageRecord = {
        _id: new Types.ObjectId(),
        messageId: message.messageId,
        to: message.to,
        type: message.type,
        content: message.content.data,
        error: errorDetails[0], // Store first error as primary
        retryCount: 0,
        createdAt: new Date(),
        status: 'pending_retry',
        metadata: {
          originalMessage: message,
          allErrors: errorDetails,
          conversationId: message.conversationId,
        },
      };

      // Store failed message
      await this.storeFailedMessage(failedMessage);

      // Update message status
      message.status = MessageStatus.FAILED;
      await MessageModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: MessageStatus.FAILED,
            'metadata.errors': errorDetails,
            'metadata.lastError': new Date(),
          },
        },
      );

      // Notify admins if critical error
      if (this.isCriticalError(errorDetails[0])) {
        await this.notifyAdmins(failedMessage);
      }

      // Schedule retry if appropriate
      if (this.shouldRetryMessage(failedMessage)) {
        await this.scheduleMessageRetry(failedMessage);
      }

      // Emit event for real-time monitoring
      if (this.socketServer) {
        this.socketServer.emit('message_failed', {
          messageId: message.messageId,
          error: errorDetails[0],
          timestamp: Date.now(),
        });
      }

      logger.error('Message failed:', {
        messageId: message.messageId,
        errors: errorDetails,
        retryStatus: failedMessage.status,
      });
    } catch (error) {
      logger.error('Error handling failed message:', error);
      // Throw to trigger global error handler
      throw new AppError(
        ErrorCode.MESSAGE_HANDLING_ERROR,
        'Failed to process failed message',
        500,
        false,
        {
          details: {
            messageId: message.messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      );
    }
  }

  /**
   * Public API Methods
   */
  public async sendMessage(
    to: string,
    type: MessageType,
    content: Record<string, unknown>,
    variables?: VariableMap,
    retryCount = 0,
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    try {
      const processedContent = variables
        ? await this.processVariables(content, variables)
        : content;

      const messageData: QueuedMessage = {
        to,
        type,
        content: processedContent,
        variables: variables || undefined, // Only include if defined
        timestamp: Date.now(),
        retryCount,
      };

      await this.channel.sendToQueue(this.QUEUE_NAME, Buffer.from(JSON.stringify(messageData)), {
        persistent: true,
        expiration: '86400000', // 24 hours
      });
    } catch (error) {
      logger.error('Error sending message:', error);
      throw error;
    }
  }

  public async sendTemplate(
    to: string,
    templateName: string,
    language: string,
    variables?: VariableMap,
  ): Promise<void> {
    try {
      const template = await TemplateModel.findOne({ name: templateName, language });
      if (!template) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Template not found', 404);
      }

      // Build template content
      const content = {
        name: template.name,
        language: {
          code: template.language,
        },
        components: await this.processTemplateComponents(template, variables),
      };

      await this.sendMessage(to, MessageType.TEMPLATE, content, variables);
    } catch (error) {
      logger.error('Error sending template message:', error);
      throw error;
    }
  }

  public async sendBulkMessages(
    messages: Array<{
      to: string;
      type: MessageType;
      content: Record<string, unknown>;
      variables?: VariableMap;
    }>,
  ): Promise<void> {
    try {
      await Promise.all(
        messages.map((message) =>
          this.sendMessage(message.to, message.type, message.content, message.variables),
        ),
      );
    } catch (error) {
      logger.error('Error sending bulk messages:', error);
      throw error;
    }
  }

  public async getConversationHistory(
    conversationId: string,
    page = 1,
    limit = 50,
  ): Promise<{
    messages: unknown[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const [messages, total] = await Promise.all([
        MessageModel.find({ conversationId: new Types.ObjectId(conversationId) })
          .sort({ timestamp: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        MessageModel.countDocuments({ conversationId: new Types.ObjectId(conversationId) }),
      ]);

      return {
        messages,
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      throw error;
    }
  }

  public async markMessagesAsRead(conversationId: string, messageIds: string[]): Promise<void> {
    try {
      await MessageModel.updateMany(
        {
          conversationId: new Types.ObjectId(conversationId),
          messageId: { $in: messageIds },
        },
        {
          $set: { status: MessageStatus.READ },
        },
      );

      // Emit status updates
      messageIds.forEach((messageId) => {
        this.emitMessageStatus(conversationId, {
          messageId,
          status: MessageStatus.READ,
          timestamp: Date.now(),
        });
      });
    } catch (error) {
      logger.error('Error marking messages as read:', error);
      throw error;
    }
  }

  public async getActiveConversations(
    page = 1,
    limit = 20,
  ): Promise<{
    conversations: unknown[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const [conversations, total] = await Promise.all([
        ConversationModel.find({ status: 'active' })
          .sort({ lastMessageAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('customerId', 'name phoneNumber')
          .lean(),
        ConversationModel.countDocuments({ status: 'active' }),
      ]);

      return {
        conversations,
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error getting active conversations:', error);
      throw error;
    }
  }

  /**
   * Template Processing
   */
  private async processTemplateComponents(
    template: ITemplate,
    variables?: VariableMap,
  ): Promise<Array<Record<string, unknown>>> {
    const processedComponents = [];

    for (const component of template.components) {
      if (component.text && variables) {
        component.text = await this.replaceVariables(component.text, variables);
      }

      const processedComponent: Record<string, unknown> = {
        type: component.type,
      };

      if (component.text) {
        processedComponent.text = component.text;
      }

      if (component.format) {
        processedComponent.format = component.format;
      }

      processedComponents.push(processedComponent);
    }

    return processedComponents;
  }

  private async collectBatchMessages(): Promise<QueuedMessage[]> {
    const messages: QueuedMessage[] = [];
    const maxBatchCollectionTime = 100; // milliseconds
    const batchStartTime = Date.now();

    while (messages.length < this.BATCH_SIZE) {
      if (Date.now() - batchStartTime > maxBatchCollectionTime) {
        break;
      }

      // Try to get more messages from the queue without blocking
      try {
        if (!this.channel) {
          break;
        }

        const msg = await this.channel.get(this.QUEUE_NAME);
        if (!msg) {
          break;
        }

        const message = JSON.parse(msg.content.toString()) as QueuedMessage;
        messages.push(message);
        this.channel.ack(msg);
      } catch (error) {
        logger.error('Error collecting batch messages:', error);
        break;
      }
    }

    return messages;
  }

  /**
   * Cleanup and Shutdown
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear rate limiters
      this.rateLimiter.clear();

      // Close RabbitMQ channel
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      // Clear socket server
      this.socketServer = null;

      logger.info('WhatsApp service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down WhatsApp service:', error);
      throw error;
    }
  }
}

export const whatsappService = WhatsAppService.getInstance();
