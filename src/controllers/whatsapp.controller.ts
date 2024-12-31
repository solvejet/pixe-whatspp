// src/controllers/whatsapp.controller.ts

import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { whatsappService } from '@/services/whatsapp.service.js';
import { customerService } from '@/services/customer.service.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { env } from '@/config/env.js';
import { successResponse } from '@/middleware/error-handler.js';
import type { AuthenticatedRequest } from '@/types/auth.js';
import type { MessageType } from '@/types/whatsapp.js';
import { Role } from '@/types/auth.js';

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
   * Send a message
   * @route POST /api/whatsapp/messages
   */
  public sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { to, type, content, variables } = req.body;

    await whatsappService.sendMessage(to, type as MessageType, content, variables);
    successResponse(res, { success: true }, 'Message sent successfully');
  };

  /**
   * Send a template message
   * @route POST /api/whatsapp/messages/template
   */
  public sendTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { to, templateName, language, variables } = req.body;

    await whatsappService.sendTemplate(to, templateName, language, variables);
    successResponse(res, { success: true }, 'Template message sent successfully');
  };

  /**
   * Send bulk messages
   * @route POST /api/whatsapp/messages/bulk
   */
  public sendBulkMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { messages } = req.body;

    await whatsappService.sendBulkMessages(messages);
    successResponse(res, { success: true }, 'Bulk messages sent successfully');
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid conversation ID format', 400);
    }

    const messages = await whatsappService.getConversationHistory(id, page, limit);
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
    }

    const conversations = await whatsappService.getActiveConversations(page, limit);
    successResponse(res, conversations);
  };

  /**
   * Mark messages as read
   * @route POST /api/whatsapp/conversations/:id/read
   */
  public markMessagesAsRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { messageIds } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid conversation ID format', 400);
    }

    await whatsappService.markMessagesAsRead(id, messageIds);
    successResponse(res, { success: true }, 'Messages marked as read');
  };

  /**
   * Get assigned customers for the authenticated user
   * @route GET /api/whatsapp/customers/assigned
   */
  public getAssignedCustomers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User not authenticated', 401);
    }

    const query: Record<string, unknown> = {};

    // If user is not admin, only show assigned customers
    if (!req.user?.roles.includes(Role.ADMIN)) {
      query.assignedAdmin = new Types.ObjectId(userId);
    }

    const customers = await customerService.listCustomers(page, limit, query);
    successResponse(res, customers);
  };
}

export const whatsappController = new WhatsAppController();
