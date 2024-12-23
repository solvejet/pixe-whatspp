// src/services/custom-field.service.ts

import { Types } from 'mongoose';
import type {
  CreateCustomFieldRequest,
  UpdateCustomFieldRequest,
  CustomFieldResponse,
  BatchUpdateCustomFieldsRequest,
  CustomFieldsService,
} from '@/types/custom-fields.js';
import type { CustomFieldType } from '@/types/customer.js';
import type { ICustomFieldDocument } from '@/models/custom-field.model.js';
import { CustomFieldModel } from '@/models/custom-field.model.js';
import { CustomerModel } from '@/models/customer.model.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { auditService } from '@/services/audit.service.js';
import { logger } from '@/utils/logger.js';

/**
 * Service for managing customer table custom fields with enhanced type safety
 */
export class CustomFieldService implements CustomFieldsService {
  private static instance: CustomFieldService;
  private readonly RESERVED_FIELD_NAMES = [
    '_id',
    'id',
    'name',
    'phoneNumber',
    'countryCode',
    'assignedAdmin',
    'status',
    'groups',
    'tags',
    'lastActivity',
    'metadata',
    'createdAt',
    'updatedAt',
  ];

  private constructor() {}

  public static getInstance(): CustomFieldService {
    if (!CustomFieldService.instance) {
      CustomFieldService.instance = new CustomFieldService();
    }
    return CustomFieldService.instance;
  }

  /**
   * Create a new custom field for customers
   * @throws {AppError} If field name already exists or is reserved
   */
  public async createCustomField(
    data: CreateCustomFieldRequest,
    userId: string,
  ): Promise<CustomFieldResponse> {
    try {
      // Check for reserved field names
      if (this.RESERVED_FIELD_NAMES.includes(data.name)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `'${data.name}' is a reserved field name`,
          400,
        );
      }

      // Check if field name already exists
      const existingField = await CustomFieldModel.findOne({ name: data.name });
      if (existingField) {
        throw new AppError(
          ErrorCode.RESOURCE_CONFLICT,
          `Custom field '${data.name}' already exists`,
          409,
        );
      }

      // Validate list options if type is LIST
      if (data.type === 'list' && (!data.listOptions || data.listOptions.length === 0)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'List options are required for LIST type fields',
          400,
        );
      }

      // Create the field
      const newField = await CustomFieldModel.create({
        ...data,
        _id: new Types.ObjectId(),
      });

      await this.logAuditEvent(userId, 'custom-field.create', 'success', {
        fieldName: data.name,
        fieldType: data.type,
      });

      return this.formatFieldResponse(newField);
    } catch (error) {
      await this.logAuditEvent(userId, 'custom-field.create', 'failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update an existing custom field
   * @throws {AppError} If field not found or new name conflicts
   */
  public async updateCustomField(
    fieldId: string,
    data: UpdateCustomFieldRequest,
    userId: string,
  ): Promise<CustomFieldResponse> {
    try {
      const field = await CustomFieldModel.findById(fieldId);
      if (!field) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Custom field not found', 404);
      }

      // Check for reserved field name if name is being updated
      if (data.name && this.RESERVED_FIELD_NAMES.includes(data.name)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `'${data.name}' is a reserved field name`,
          400,
        );
      }

      // Check name uniqueness if being updated
      if (data.name && data.name !== field.name) {
        const existingField = await CustomFieldModel.findOne({ name: data.name });
        if (existingField) {
          throw new AppError(
            ErrorCode.RESOURCE_CONFLICT,
            `Custom field name '${data.name}' already exists`,
            409,
          );
        }
      }

      // Validate type change
      if (data.type && data.type !== field.type) {
        const usageCount = await this.checkFieldUsage(field.name);
        if (usageCount > 0) {
          throw new AppError(
            ErrorCode.OPERATION_NOT_ALLOWED,
            'Cannot change type of field that is in use',
            400,
            true,
            { details: { customerCount: usageCount } },
          );
        }
      }

      // Update the field
      Object.assign(field, data);
      await field.save();

      await this.logAuditEvent(userId, 'custom-field.update', 'success', {
        fieldId,
        updates: data,
      });

      return this.formatFieldResponse(field);
    } catch (error) {
      await this.logAuditEvent(userId, 'custom-field.update', 'failure', {
        fieldId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete a custom field
   * @throws {AppError} If field not found or in use
   */
  public async deleteCustomField(fieldId: string, userId: string): Promise<void> {
    try {
      const field = await CustomFieldModel.findById(fieldId);
      if (!field) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Custom field not found', 404);
      }

      // Check if any customers are using this field
      const usageCount = await this.checkFieldUsage(field.name);
      if (usageCount > 0) {
        throw new AppError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete field that is in use by customers',
          400,
          true,
          { details: { customerCount: usageCount } },
        );
      }

      await field.deleteOne();

      await this.logAuditEvent(userId, 'custom-field.delete', 'success', {
        fieldId,
        fieldName: field.name,
      });
    } catch (error) {
      await this.logAuditEvent(userId, 'custom-field.delete', 'failure', {
        fieldId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get a specific custom field
   * @throws {AppError} If field not found
   */
  public async getCustomField(fieldId: string): Promise<CustomFieldResponse> {
    const field = await CustomFieldModel.findById(fieldId);
    if (!field) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Custom field not found', 404);
    }

    return this.formatFieldResponse(field);
  }

  /**
   * List all custom fields with pagination
   */
  public async listCustomFields(
    page = 1,
    limit = 10,
  ): Promise<{
    fields: CustomFieldResponse[];
    total: number;
    pages: number;
  }> {
    const [fields, total] = await Promise.all([
      CustomFieldModel.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      CustomFieldModel.countDocuments(),
    ]);

    return {
      fields: fields.map((field) => this.formatFieldResponse(field)),
      total,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Format field response with proper typing
   * @private
   */
  private formatFieldResponse(field: ICustomFieldDocument): CustomFieldResponse {
    return {
      id: field._id.toString(),
      name: field.name,
      type: field.type as CustomFieldType,
      required: field.required || false,
      listOptions: field.listOptions || [],
      defaultValue: field.defaultValue,
      description: field.description,
      validation: field.validation,
      createdAt: field.createdAt.toISOString(),
      updatedAt: field.updatedAt.toISOString(),
    };
  }

  /**
   * Check if any customers are using a specific field
   * @private
   */
  /**
   * Check if any customers are using a specific field
   * Queries CustomerModel to find documents where the custom field is in use
   * @private
   * @param fieldName - Name of the custom field to check
   * @returns Promise resolving to the count of customers using this field
   */
  private async checkFieldUsage(fieldName: string): Promise<number> {
    try {
      const query = {
        [`customFields.${fieldName}`]: { $exists: true },
      };

      const count = await CustomerModel.countDocuments(query);

      if (count > 0) {
        logger.debug(`Field "${fieldName}" is in use by ${count} customers`);
      }

      return count;
    } catch (error) {
      logger.error('Error checking field usage:', {
        fieldName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Failed to check field usage', 500, false, {
        details: {
          fieldName,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Log audit events
   * @private
   */
  private async logAuditEvent(
    userId: string,
    action: string,
    status: 'success' | 'failure',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await auditService.log({
        userId,
        action,
        category: 'data',
        details,
        ipAddress: 'system',
        userAgent: 'system',
        status,
      });
    } catch (error) {
      logger.error('Error logging audit event:', error);
    }
  }

  /**
   * Batch update custom fields
   * @throws {AppError} If validation fails
   */
  public async batchUpdateCustomFields(
    updates: BatchUpdateCustomFieldsRequest,
    userId: string,
  ): Promise<CustomFieldResponse[]> {
    try {
      // Map to store name updates for uniqueness check
      const nameUpdates = new Map<string, string>();

      // Validate all updates first
      for (const update of updates.fields) {
        const field = await CustomFieldModel.findById(update.id);
        if (!field) {
          throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, `Field ${update.id} not found`, 404);
        }

        if (update.updates.name) {
          // Check reserved names
          if (this.RESERVED_FIELD_NAMES.includes(update.updates.name)) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `'${update.updates.name}' is a reserved field name`,
              400,
            );
          }

          // Check for duplicate names in current updates
          if (nameUpdates.has(update.updates.name)) {
            throw new AppError(
              ErrorCode.RESOURCE_CONFLICT,
              `Multiple fields trying to use name '${update.updates.name}'`,
              409,
            );
          }

          // Check against existing fields
          if (update.updates.name !== field.name) {
            const existingField = await CustomFieldModel.findOne({ name: update.updates.name });
            if (existingField) {
              throw new AppError(
                ErrorCode.RESOURCE_CONFLICT,
                `Custom field name '${update.updates.name}' already exists`,
                409,
              );
            }
            nameUpdates.set(update.updates.name, field.name);
          }
        }

        // Validate type change
        if (update.updates.type && update.updates.type !== field.type) {
          const usageCount = await this.checkFieldUsage(field.name);
          if (usageCount > 0) {
            throw new AppError(
              ErrorCode.OPERATION_NOT_ALLOWED,
              `Cannot change type of field '${field.name}' that is in use`,
              400,
              true,
              { details: { customerCount: usageCount } },
            );
          }
        }
      }

      // Apply all updates
      const updatedFields = await Promise.all(
        updates.fields.map(async (update) => {
          const field = await CustomFieldModel.findByIdAndUpdate(
            update.id,
            { $set: update.updates },
            { new: true },
          );
          if (!field) {
            throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, `Field ${update.id} not found`, 404);
          }
          return field;
        }),
      );

      await this.logAuditEvent(userId, 'custom-field.batch-update', 'success', {
        updatedCount: updates.fields.length,
      });

      return updatedFields.map((field) => this.formatFieldResponse(field));
    } catch (error) {
      await this.logAuditEvent(userId, 'custom-field.batch-update', 'failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

export const customFieldService = CustomFieldService.getInstance();
