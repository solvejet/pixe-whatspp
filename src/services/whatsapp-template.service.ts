// src/services/whatsapp-template.service.ts

import { Types } from 'mongoose';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import {
  WhatsAppTemplateModel,
  type IWhatsAppTemplateDocument,
} from '@/models/whatsapp-template.model.js';
import { Redis } from '@/config/redis.js';
import type {
  CreateTemplateRequest,
  UpdateTemplateRequest,
  TemplateResponse,
  WhatsAppAPITemplateResponse,
} from '@/types/whatsapp.template.js';

interface WhatsAppAPIListResponse {
  data: WhatsAppAPITemplateResponse[];
}

export class WhatsAppTemplateService {
  private static instance: WhatsAppTemplateService;
  private readonly CACHE_PREFIX = 'whatsapp:template:';
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly API_VERSION = 'v21.0';
  private readonly API_BASE_URL = 'https://graph.facebook.com';

  private constructor() {}

  public static getInstance(): WhatsAppTemplateService {
    if (!WhatsAppTemplateService.instance) {
      WhatsAppTemplateService.instance = new WhatsAppTemplateService();
    }
    return WhatsAppTemplateService.instance;
  }

  /**
   * Create a new WhatsApp message template
   */
  public async createTemplate(
    data: CreateTemplateRequest,
    userId: string,
  ): Promise<TemplateResponse> {
    try {
      // Create template in WhatsApp Business API
      const whatsappResponse = await this.createWhatsAppTemplate(data);

      // Save template in database
      const template = await WhatsAppTemplateModel.create({
        ...data,
        whatsappTemplateId: whatsappResponse.id,
        status: whatsappResponse.status,
        createdBy: new Types.ObjectId(userId),
        updatedBy: new Types.ObjectId(userId),
      });

      // Cache the template
      const response = this.formatTemplateResponse(template);
      await this.cacheTemplate(template._id.toString(), response);

      return response;
    } catch (error) {
      logger.error('Error creating WhatsApp template:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get template by ID with caching
   */
  public async getTemplateById(id: string): Promise<TemplateResponse> {
    try {
      // Check cache first
      const cached = await Redis.get(`${this.CACHE_PREFIX}${id}`);
      if (cached) {
        return JSON.parse(cached) as TemplateResponse;
      }

      const template = await WhatsAppTemplateModel.findById(id);
      if (!template) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Template not found', 404);
      }

      const response = this.formatTemplateResponse(template);
      await this.cacheTemplate(id, response);

      return response;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update template
   */
  public async updateTemplate(
    id: string,
    data: UpdateTemplateRequest,
    userId: string,
  ): Promise<TemplateResponse> {
    try {
      const template = await WhatsAppTemplateModel.findById(id);
      if (!template) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Template not found', 404);
      }

      // Update template in WhatsApp Business API
      if (template.whatsappTemplateId) {
        await this.updateWhatsAppTemplate(template.whatsappTemplateId, data);
      }

      // Update template in database
      Object.assign(template, {
        ...data,
        updatedBy: new Types.ObjectId(userId),
      });
      await template.save();

      // Update cache
      const response = this.formatTemplateResponse(template);
      await this.cacheTemplate(id, response);

      return response;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete template
   */
  public async deleteTemplate(id: string): Promise<void> {
    try {
      const template = await WhatsAppTemplateModel.findById(id);
      if (!template) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Template not found', 404);
      }

      // Delete from WhatsApp Business API
      if (template.whatsappTemplateId) {
        await this.deleteWhatsAppTemplate(template.whatsappTemplateId);
      }

      // Delete from database
      await template.deleteOne();

      // Remove from cache
      await Redis.del(`${this.CACHE_PREFIX}${id}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * List templates with pagination and filtering
   */
  public async listTemplates(
    page = 1,
    limit = 10,
    filters?: {
      category?: string;
      status?: string;
      language?: string;
      search?: string;
    },
  ): Promise<{
    templates: TemplateResponse[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const query: Record<string, unknown> = {};

      if (filters?.category) {
        query.category = filters.category;
      }

      if (filters?.status) {
        query.status = filters.status;
      }

      if (filters?.language) {
        query['language.code'] = filters.language;
      }

      if (filters?.search) {
        query.$or = [
          { name: new RegExp(filters.search, 'i') },
          { 'components.text': new RegExp(filters.search, 'i') },
        ];
      }

      const [templates, total] = await Promise.all([
        WhatsAppTemplateModel.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        WhatsAppTemplateModel.countDocuments(query),
      ]);

      return {
        templates: templates.map(this.formatTemplateResponse),
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Sync templates from WhatsApp Business API
   */
  public async syncTemplates(userId: string): Promise<void> {
    try {
      // Fetch templates from WhatsApp API
      const whatsappTemplates = await this.fetchWhatsAppTemplates();

      // Create batch operations
      const operations = whatsappTemplates.map((template) => ({
        updateOne: {
          filter: {
            name: template.name,
            'language.code': template.language,
          },
          update: {
            $set: {
              whatsappTemplateId: template.id,
              status: template.status,
              components: template.components,
              category: template.category,
              updatedBy: new Types.ObjectId(userId),
            },
          },
          upsert: true,
        },
      }));

      // Execute batch update
      await WhatsAppTemplateModel.bulkWrite(operations);

      // Clear cache
      const keys = await Redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await Redis.deleteMany(keys);
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Private helper methods
   */

  private isWhatsAppAPIResponse(data: unknown): data is WhatsAppAPITemplateResponse {
    return (
      typeof data === 'object' &&
      data !== null &&
      'name' in data &&
      'status' in data &&
      'id' in data
    );
  }

  private isWhatsAppAPIListResponse(data: unknown): data is WhatsAppAPIListResponse {
    return (
      typeof data === 'object' &&
      data !== null &&
      'data' in data &&
      Array.isArray((data as WhatsAppAPIListResponse).data)
    );
  }

  private handleError(error: unknown): never {
    logger.error('WhatsApp template service error:', error);

    if (error instanceof AppError) {
      throw error;
    }

    const details: Record<string, unknown> = {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    };

    if (error instanceof Error) {
      details.stack = error.stack;
      details.name = error.name;
    }

    throw new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'WhatsApp template operation failed',
      500,
      false,
      { details },
    );
  }

  private async cacheTemplate(id: string, template: TemplateResponse): Promise<void> {
    try {
      await Redis.setEx(`${this.CACHE_PREFIX}${id}`, this.CACHE_TTL, JSON.stringify(template));
    } catch (error) {
      logger.warn('Failed to cache template:', error);
    }
  }

  private formatTemplateResponse(template: IWhatsAppTemplateDocument): TemplateResponse {
    return {
      id: template._id.toString(),
      name: template.name,
      category: template.category,
      components: template.components,
      language: template.language,
      status: template.status,
      whatsappTemplateId: template.whatsappTemplateId,
      metadata: Object.fromEntries(template.metadata ?? new Map()),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private async createWhatsAppTemplate(
    data: CreateTemplateRequest,
  ): Promise<WhatsAppAPITemplateResponse> {
    try {
      const response = await fetch(
        `${this.API_BASE_URL}/${this.API_VERSION}/${env.WHATSAPP_BUSINESS_ID}/message_templates`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: data.name,
            category: data.category,
            components: data.components,
            language: data.language.code,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to create WhatsApp template',
          response.status,
          true,
          {
            details:
              error && typeof error === 'object' ? (error as Record<string, unknown>) : { error },
          },
        );
      }

      const responseData = await response.json();

      if (!this.isWhatsAppAPIResponse(responseData)) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Invalid API response format',
          500,
          false,
          { details: { response: responseData } },
        );
      }

      return responseData;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async updateWhatsAppTemplate(
    templateId: string,
    data: UpdateTemplateRequest,
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.API_BASE_URL}/${this.API_VERSION}/${env.WHATSAPP_BUSINESS_ID}/message_templates/${templateId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: data.category,
            components: data.components,
            language: data.language?.code,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to update WhatsApp template',
          response.status,
          true,
          {
            details:
              error && typeof error === 'object' ? (error as Record<string, unknown>) : { error },
          },
        );
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async deleteWhatsAppTemplate(templateId: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.API_BASE_URL}/${this.API_VERSION}/${env.WHATSAPP_BUSINESS_ID}/message_templates/${templateId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to delete WhatsApp template',
          response.status,
          true,
          {
            details:
              error && typeof error === 'object' ? (error as Record<string, unknown>) : { error },
          },
        );
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private async fetchWhatsAppTemplates(): Promise<WhatsAppAPITemplateResponse[]> {
    try {
      const response = await fetch(
        `${this.API_BASE_URL}/${this.API_VERSION}/${env.WHATSAPP_BUSINESS_ID}/message_templates`,
        {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          },
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to fetch WhatsApp templates',
          response.status,
          true,
          {
            details:
              error && typeof error === 'object' ? (error as Record<string, unknown>) : { error },
          },
        );
      }

      const data = await response.json();

      if (!this.isWhatsAppAPIListResponse(data)) {
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Invalid API response format',
          500,
          false,
          { details: { response: data } },
        );
      }

      return data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
}

export const whatsappTemplateService = WhatsAppTemplateService.getInstance();
