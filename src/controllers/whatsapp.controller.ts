// src/controllers/whatsapp.controller.ts

import type { Request, Response } from 'express';
import { whatsappService } from '@/services/whatsapp.service.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { env } from '@/config/env.js';
import { successResponse } from '@/middleware/error-handler.js';
import type { AuthenticatedRequest } from '@/types/auth.js';

export class WhatsAppController {
  /**
   * Handle webhook verification from WhatsApp
   * @route GET /api/whatsapp/webhook
   */
  public verifyWebhook = async (req: Request, res: Response): Promise<void> => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      logger.info('WhatsApp webhook verified');
      res.status(200).send(challenge);
      return;
    }

    throw new AppError(ErrorCode.UNAUTHORIZED, 'Webhook verification failed', 403);
  };

  /**
   * Handle incoming webhook events from WhatsApp
   * @route POST /api/whatsapp/webhook
   */
  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      await whatsappService.handleWebhook(req.body);
      res.status(200).send('OK');
    } catch (error) {
      logger.error('Error handling webhook:', error);
      res.status(200).send('OK'); // Always return 200 to WhatsApp
      throw error;
    }
  };

  /**
   * Send a message to a WhatsApp user
   * @route POST /api/whatsapp/messages
   */
  public sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { to, type, content, variables } = req.body;

    await whatsappService.sendMessage(to, type, content, variables);
    successResponse(res, { success: true }, 'Message sent successfully');
  };

  /**
   * Get conversation history
   * @route GET /api/whatsapp/conversations/:id/messages
   */
  public getConversationHistory = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    const { id } = req.params;
    const { page = '1', limit = '50' } = req.query;

    const messages = await this.getMessageHistory(id, Number(page), Number(limit));
    successResponse(res, messages);
  };

  /**
   * Get active conversations
   * @route GET /api/whatsapp/conversations
   */
  public getActiveConversations = async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    const { page = '1', limit = '20' } = req.query;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
    }

    const conversations = await this.getConversations(userId, Number(page), Number(limit));
    successResponse(res, conversations);
  };

  /**
   * Mark conversation as closed
   * @route POST /api/whatsapp/conversations/:id/close
   */
  public closeConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
    }

    await this.markConversationClosed(id, userId);
    successResponse(res, { success: true }, 'Conversation closed successfully');
  };

  /**
   * Get message history
   */
  private async getMessageHistory(
    conversationId: string,
    page: number,
    limit: number,
  ): Promise<{
    messages: unknown[];
    total: number;
    page: number;
    pages: number;
  }> {
    // Implement pagination and message fetching logic
    return {
      messages: [],
      total: 0,
      page,
      pages: 0,
    };
  }

  /**
   * Get conversations
   */
  private async getConversations(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    conversations: unknown[];
    total: number;
    page: number;
    pages: number;
  }> {
    // Implement conversation fetching logic
    return {
      conversations: [],
      total: 0,
      page,
      pages: 0,
    };
  }

  /**
   * Mark conversation as closed
   */
  private async markConversationClosed(conversationId: string, userId: string): Promise<void> {
    // Implement conversation closing logic
  }
}

export const whatsappController = new WhatsAppController();
