// src/middleware/customer.middleware.ts

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '@/types/auth.js';
import { ApiError } from './error-handler.js';
import { customerService } from '@/services/customer.service.js';
import type { ICustomField } from '@/types/customer.js';

// Define request types for type safety
interface SchemaUpdateRequest extends AuthenticatedRequest {
  body: {
    fields: ICustomField[];
  };
}

interface CustomerCreateRequest extends AuthenticatedRequest {
  body: {
    name: string;
    phoneNumber: {
      countryCode: string;
      number: string;
    };
    assignedAdmin: string;
    customFields?: Record<string, unknown>;
  };
}

interface CustomerUpdateRequest extends AuthenticatedRequest {
  body: {
    customFields?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export class CustomerMiddleware {
  static async validateSchemaUpdate(
    req: SchemaUpdateRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { fields } = req.body;

      if (!Array.isArray(fields)) {
        throw new ApiError(400, 'Fields must be an array');
      }

      // Validate field names
      const fieldNames = new Set<string>();
      for (const field of fields) {
        // Check for required properties
        if (!field.name || !field.type) {
          throw new ApiError(400, 'Each field must have a name and type');
        }

        // Check for duplicate field names
        if (fieldNames.has(field.name)) {
          throw new ApiError(400, `Duplicate field name: ${field.name}`);
        }
        fieldNames.add(field.name);

        // Validate field name format
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
          throw new ApiError(
            400,
            'Field names must start with a letter and contain only letters, numbers, and underscores',
          );
        }

        // Validate select field options
        if (
          field.type === 'select' &&
          (!Array.isArray(field.options) || field.options.length === 0)
        ) {
          throw new ApiError(400, `Select field ${field.name} must have options`);
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  static async validateCustomerCreate(
    req: CustomerCreateRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { name, phoneNumber, assignedAdmin } = req.body;

      // Validate required fields
      if (!name || typeof name !== 'string') {
        throw new ApiError(400, 'Valid name is required');
      }

      if (!phoneNumber || !phoneNumber.countryCode || !phoneNumber.number) {
        throw new ApiError(400, 'Valid phone number with country code is required');
      }

      if (!assignedAdmin) {
        throw new ApiError(400, 'Assigned admin is required');
      }

      // Validate phone number format
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phoneNumber.number.replace(/\D/g, ''))) {
        throw new ApiError(400, 'Invalid phone number format');
      }

      // Validate country code format
      if (!/^\+\d{1,3}$/.test(phoneNumber.countryCode)) {
        throw new ApiError(400, 'Invalid country code format');
      }

      // Get active schema to validate custom fields
      const schema = await customerService.getActiveSchema();
      const customFields = req.body.customFields || {};

      for (const field of schema.fields) {
        if (!field.isDefault) {
          const value = customFields[field.name];
          if (field.required && value === undefined) {
            throw new ApiError(400, `${field.name} is required`);
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  static async validateCustomerUpdate(
    req: CustomerUpdateRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { customFields } = req.body;

      // Get active schema to validate custom fields
      const schema = await customerService.getActiveSchema();

      if (customFields) {
        for (const [key, value] of Object.entries(customFields)) {
          const fieldSchema = schema.fields.find((f) => f.name === key);
          if (!fieldSchema) {
            throw new ApiError(400, `Unknown field: ${key}`);
          }

          // Type validation based on field type
          switch (fieldSchema.type) {
            case 'number':
              if (value !== undefined && typeof value !== 'number') {
                throw new ApiError(400, `${key} must be a number`);
              }
              break;
            case 'select':
              if (value !== undefined && !fieldSchema.options?.includes(value as string)) {
                throw new ApiError(400, `Invalid option for ${key}`);
              }
              break;
            case 'date':
              if (value !== undefined && isNaN(Date.parse(String(value)))) {
                throw new ApiError(400, `${key} must be a valid date`);
              }
              break;
            case 'boolean':
              if (value !== undefined && typeof value !== 'boolean') {
                throw new ApiError(400, `${key} must be a boolean`);
              }
              break;
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }
}
