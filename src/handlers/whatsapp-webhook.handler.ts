// src/handlers/whatsapp-webhook.handler.ts
import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { whatsappChatService } from '@/services/whatsapp-chat.service.js';
import type {
  WhatsAppWebhook,
  WebhookMessage,
  MessageStatus,
  WebhookValue,
  MessageType,
} from '@/types/whatsapp.chat.js';

interface WebhookHeaders extends IncomingHttpHeaders {
  'x-hub-signature'?: string;
  'x-hub-signature-256'?: string;
}

interface CustomerData {
  name: string;
  whatsappId: string;
  phoneNumber: string;
}

export class WhatsAppWebhookHandler {
  private static instance: WhatsAppWebhookHandler;
  private readonly RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  private constructor() {}

  public static getInstance(): WhatsAppWebhookHandler {
    if (!WhatsAppWebhookHandler.instance) {
      WhatsAppWebhookHandler.instance = new WhatsAppWebhookHandler();
    }
    return WhatsAppWebhookHandler.instance;
  }

  /**
   * Type guard for checking message types
   */
  private isMessageType<T extends MessageType>(
    message: WebhookMessage,
    type: T,
  ): message is WebhookMessage & { type: T } {
    return message.type === type;
  }

  /**
   * Type guard for checking message content
   */
  private hasMessageContent<T extends keyof WebhookMessage>(
    message: WebhookMessage,
    key: T,
  ): message is WebhookMessage & { [K in T]-?: NonNullable<WebhookMessage[K]> } {
    return message[key] !== undefined && message[key] !== null;
  }

  /**
   * Verify webhook signature
   */
  public verifySignature(body: string, headers: WebhookHeaders): boolean {
    try {
      const signature = headers['x-hub-signature-256'];
      if (!signature) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Missing webhook signature', 401);
      }

      const [, signatureHash] = signature.split('=');
      const expectedHash = crypto
        .createHmac('sha256', env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
        .update(body)
        .digest('hex');

      return signatureHash === expectedHash;
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  /**
   * Process webhook
   */
  public async handleWebhook(webhook: WhatsAppWebhook): Promise<void> {
    try {
      for (const entry of webhook.entry) {
        for (const change of entry.changes) {
          const value = change.value;

          if (!this.isValidWebhookValue(value)) {
            logger.warn('Invalid webhook value:', value);
            continue;
          }

          if (change.field === 'messages') {
            if (value.messages?.length) {
              await this.processMessages(value);
            }

            if (value.statuses?.length) {
              await this.processStatuses(value.statuses);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error processing webhook:', error);
      throw new AppError(ErrorCode.MESSAGE_HANDLING_ERROR, 'Failed to process webhook', 500);
    }
  }

  /**
   * Validate webhook value
   */
  private isValidWebhookValue(value: unknown): value is WebhookValue {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<WebhookValue>;

    return (
      v.messaging_product === 'whatsapp' &&
      typeof v.metadata?.display_phone_number === 'string' &&
      typeof v.metadata?.phone_number_id === 'string'
    );
  }

  /**
   * Process messages
   */
  private async processMessages(value: WebhookValue): Promise<void> {
    const { messages, contacts } = value;
    if (!messages || !contacts) return;

    for (const message of messages) {
      const contact = contacts.find((c) => c.wa_id === message.from);
      if (!contact) {
        logger.warn('No contact info for message:', { messageId: message.id });
        continue;
      }

      try {
        const customer = await this.getOrCreateCustomer({
          name: contact.profile.name,
          whatsappId: contact.wa_id,
          phoneNumber: message.from,
        });

        await this.processMessageWithRetry(message, customer.id);
      } catch (error) {
        logger.error('Error processing message:', {
          error,
          messageId: message.id,
          type: message.type,
        });
      }
    }
  }

  /**
   * Get or create customer
   */
  private async getOrCreateCustomer(data: CustomerData): Promise<{ id: string }> {
    const existing = await whatsappChatService.findCustomerByWhatsAppId(data.whatsappId);
    if (existing) return existing;

    return await whatsappChatService.createCustomer(data);
  }

  /**
   * Process message with retry
   */
  private async processMessageWithRetry(
    message: WebhookMessage,
    customerId: string,
    attempt = 1,
  ): Promise<void> {
    try {
      if (this.isMessageType(message, 'text') && this.hasMessageContent(message, 'text')) {
        await whatsappChatService.processTextMessage(message, customerId);
      } else if (
        this.isMessageType(message, 'reaction') &&
        this.hasMessageContent(message, 'reaction')
      ) {
        await whatsappChatService.processReactionMessage(message, customerId);
      } else if (
        (this.isMessageType(message, 'image') && this.hasMessageContent(message, 'image')) ||
        (this.isMessageType(message, 'video') && this.hasMessageContent(message, 'video')) ||
        (this.isMessageType(message, 'audio') && this.hasMessageContent(message, 'audio')) ||
        (this.isMessageType(message, 'document') && this.hasMessageContent(message, 'document'))
      ) {
        await whatsappChatService.processMediaMessage(message, customerId);
      } else if (
        this.isMessageType(message, 'location') &&
        this.hasMessageContent(message, 'location')
      ) {
        await whatsappChatService.processLocationMessage(message, customerId);
      } else if (
        this.isMessageType(message, 'contacts') &&
        this.hasMessageContent(message, 'contacts')
      ) {
        await whatsappChatService.processContactMessage(message, customerId);
      } else if (
        this.isMessageType(message, 'interactive') &&
        this.hasMessageContent(message, 'interactive')
      ) {
        await whatsappChatService.processInteractiveMessage(message, customerId);
      } else if (
        this.isMessageType(message, 'button') &&
        this.hasMessageContent(message, 'button')
      ) {
        await whatsappChatService.processButtonMessage(message, customerId);
      } else {
        if (this.hasMessageContent(message, 'referral')) {
          await whatsappChatService.processReferralMessage(message, customerId);
        } else {
          logger.warn('Unsupported or unknown message type:', {
            type: message.type,
            messageId: message.id,
          });
        }
      }
    } catch (error) {
      if (attempt < this.RETRY_ATTEMPTS) {
        logger.warn(`Retrying message processing (${attempt + 1}/${this.RETRY_ATTEMPTS}):`, {
          messageId: message.id,
          error,
        });

        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY * attempt));
        await this.processMessageWithRetry(message, customerId, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Process status updates
   */
  private async processStatuses(statuses: MessageStatus[]): Promise<void> {
    for (const status of statuses) {
      try {
        await whatsappChatService.updateMessageStatus(
          status.id,
          status.status,
          status.conversation,
          status.pricing,
        );

        if (status.status === 'failed' && status.errors?.length) {
          logger.error('Message delivery failed:', {
            messageId: status.id,
            errors: status.errors,
            recipientId: status.recipient_id,
          });
        }
      } catch (error) {
        logger.error('Error processing status update:', {
          error,
          messageId: status.id,
          status: status.status,
        });
      }
    }
  }
}

export const whatsappWebhookHandler = WhatsAppWebhookHandler.getInstance();
