// src/controllers/custom-field.controller.ts

import type { Response } from 'express';
import type { AuthenticatedRequest, BaseRequestParams } from '@/types/auth.js';
import type {
  CreateCustomFieldRequest,
  UpdateCustomFieldRequest,
  BatchUpdateCustomFieldsRequest,
} from '@/types/custom-fields.js';
import { customFieldService } from '@/services/custom-field.service.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { Types } from 'mongoose';

/**
 * Interface for request parameters containing IDs
 */
interface FieldIdParams extends BaseRequestParams {
  fieldId: string;
}

/**
 * Type definitions for request bodies
 */
interface CreateFieldRequest extends AuthenticatedRequest {
  body: CreateCustomFieldRequest;
}

interface UpdateFieldRequest extends AuthenticatedRequest {
  body: UpdateCustomFieldRequest;
  params: FieldIdParams;
}

interface BatchUpdateRequest extends AuthenticatedRequest {
  body: BatchUpdateCustomFieldsRequest;
}

interface GetFieldRequest extends AuthenticatedRequest {
  params: FieldIdParams;
}

interface ListFieldsRequest extends AuthenticatedRequest {
  query: {
    page?: string;
    limit?: string;
  };
}

/**
 * Controller for managing custom field operations
 */
export class CustomFieldController {
  /**
   * Create a new custom field
   * @route POST /api/customers/fields
   */
  public createCustomField = async (req: CreateFieldRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const field = await customFieldService.createCustomField(req.body, userId);
    successResponse(res, field, 'Custom field created successfully', 201);
  };

  /**
   * Update an existing custom field
   * @route PUT /api/customers/fields/:fieldId
   */
  public updateCustomField = async (req: UpdateFieldRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const { fieldId } = req.params;
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid field ID format', 400);
    }

    const field = await customFieldService.updateCustomField(fieldId, req.body, userId);
    successResponse(res, field, 'Custom field updated successfully');
  };

  /**
   * Delete a custom field
   * @route DELETE /api/customers/fields/:fieldId
   */
  public deleteCustomField = async (req: GetFieldRequest, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const { fieldId } = req.params;
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid field ID format', 400);
    }

    await customFieldService.deleteCustomField(fieldId, userId);
    successResponse(res, null, 'Custom field deleted successfully', 204);
  };

  /**
   * Get custom field by ID
   * @route GET /api/customers/fields/:fieldId
   */
  public getCustomField = async (req: GetFieldRequest, res: Response): Promise<void> => {
    const { fieldId } = req.params;
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid field ID format', 400);
    }

    const field = await customFieldService.getCustomField(fieldId);
    successResponse(res, field);
  };

  /**
   * List custom fields with pagination
   * @route GET /api/customers/fields
   */
  public listCustomFields = async (req: ListFieldsRequest, res: Response): Promise<void> => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    if (isNaN(page) || page < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid page number', 400);
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid limit value', 400);
    }

    const fields = await customFieldService.listCustomFields(page, limit);
    successResponse(res, fields);
  };

  /**
   * Batch update custom fields
   * @route PATCH /api/customers/fields/batch
   */
  public batchUpdateCustomFields = async (
    req: BatchUpdateRequest,
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    // Validate all field IDs in the batch
    const invalidIds = req.body.fields.filter((field) => !Types.ObjectId.isValid(field.id));
    if (invalidIds.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid field ID format in batch update',
        400,
        true,
        { details: { invalidIds: invalidIds.map((f) => f.id) } },
      );
    }

    const fields = await customFieldService.batchUpdateCustomFields(req.body, userId);
    successResponse(res, fields, 'Custom fields updated successfully');
  };
}
