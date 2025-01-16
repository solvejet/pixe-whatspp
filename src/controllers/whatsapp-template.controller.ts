// src/controllers/whatsapp-template.controller.ts

import type { Response } from 'express';
import type { AuthenticatedRequest } from '@/types/auth.js';
import type { CreateTemplateRequest, UpdateTemplateRequest } from '@/types/whatsapp.template.js';
import { whatsappTemplateService } from '@/services/whatsapp-template.service.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { Types } from 'mongoose';

interface RequestWithId extends AuthenticatedRequest {
  params: {
    id: string;
  };
}

interface ListTemplatesRequest extends AuthenticatedRequest {
  query: {
    page?: string;
    limit?: string;
    category?: string;
    status?: string;
    language?: string;
    search?: string;
  };
}

export class WhatsAppTemplateController {
  /**
   * Create new template
   * @route POST /api/whatsapp/templates
   */
  public createTemplate = async (
    req: AuthenticatedRequest & { body: CreateTemplateRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const template = await whatsappTemplateService.createTemplate(req.body, userId);
    successResponse(res, template, 'Template created successfully', 201);
  };

  /**
   * Get template by ID
   * @route GET /api/whatsapp/templates/:id
   */
  public getTemplateById = async (req: RequestWithId, res: Response): Promise<void> => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid template ID format', 400);
    }

    const template = await whatsappTemplateService.getTemplateById(req.params.id);
    successResponse(res, template);
  };

  /**
   * Update template
   * @route PUT /api/whatsapp/templates/:id
   */
  public updateTemplate = async (
    req: RequestWithId & { body: UpdateTemplateRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    if (!Types.ObjectId.isValid(req.params.id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid template ID format', 400);
    }

    const template = await whatsappTemplateService.updateTemplate(req.params.id, req.body, userId);
    successResponse(res, template, 'Template updated successfully');
  };

  /**
   * Delete template
   * @route DELETE /api/whatsapp/templates/:id
   */
  public deleteTemplate = async (req: RequestWithId, res: Response): Promise<void> => {
    if (!Types.ObjectId.isValid(req.params.id)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid template ID format', 400);
    }

    await whatsappTemplateService.deleteTemplate(req.params.id);
    successResponse(res, null, 'Template deleted successfully', 204);
  };

  /**
   * List templates
   * @route GET /api/whatsapp/templates
   */
  public listTemplates = async (req: ListTemplatesRequest, res: Response): Promise<void> => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const filters = {
      category: req.query.category,
      status: req.query.status,
      language: req.query.language,
      search: req.query.search,
    };

    const templates = await whatsappTemplateService.listTemplates(page, limit, filters);
    successResponse(res, templates);
  };

  /**
   * Sync templates with WhatsApp Business API
   * @route POST /api/whatsapp/templates/sync
   */
  public syncTemplates = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    await whatsappTemplateService.syncTemplates(userId);
    successResponse(res, null, 'Templates synced successfully');
  };
}
