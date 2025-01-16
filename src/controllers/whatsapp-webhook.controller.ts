// src/controllers/whatsapp-webhook.controller.ts

import type { Request, Response } from 'express';
import { env } from '@/config/env.js';
import { whatsappWebhookHandler } from '@/handlers/whatsapp-webhook.handler.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import type { WhatsAppWebhook } from '@/types/whatsapp.chat.js';

export class WhatsAppWebhookController {
  /**
   * Verify webhook endpoint for WhatsApp Business API
   * @route GET /api/whatsapp/webhook
   */
  public verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      res.status(200).send(challenge);
      return;
    }

    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid webhook verification token', 401);
  }

  /**
   * Handle incoming messages from WhatsApp Business API
   * @route POST /api/whatsapp/webhook
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Verify request signature
      const signature = req.headers['x-hub-signature-256'];
      const body = JSON.stringify(req.body);

      if (!signature || !whatsappWebhookHandler.verifySignature(body, req.headers)) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid webhook signature', 401);
      }

      // Process webhook asynchronously and return response immediately
      // This prevents webhook timeout and retries from WhatsApp
      setImmediate(async () => {
        try {
          await whatsappWebhookHandler.handleWebhook(req.body as WhatsAppWebhook);
        } catch (error) {
          logger.error('Error processing webhook:', error);
        }
      });

      // Return success response immediately
      await successResponse(res, null, 'Webhook received');
    } catch (error) {
      logger.error('Webhook handling error:', error);
      throw error;
    }
  }
}

export const whatsappWebhookController = new WhatsAppWebhookController();
