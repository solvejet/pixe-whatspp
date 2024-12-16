// src/services/customer.service.ts

import { Types } from 'mongoose';
import { CustomerModel, CustomerSchemaModel } from '@/models/customer.model.js';
import type { ICustomField, ICustomer, ICustomerSchema } from '@/types/customer.js';
import { ApiError } from '@/middleware/error-handler.js';
import { logger } from '@/utils/logger.js';

export class CustomerService {
  private static instance: CustomerService;

  private constructor() {}

  public static getInstance(): CustomerService {
    if (!CustomerService.instance) {
      CustomerService.instance = new CustomerService();
    }
    return CustomerService.instance;
  }

  private validateFieldValue(field: ICustomField, value: unknown): boolean {
    if (field.required && (value === null || value === undefined)) {
      return false;
    }

    switch (field.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'select':
        return (
          typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value)
        );
      case 'date':
        return value instanceof Date || !isNaN(Date.parse(String(value)));
      case 'boolean':
        return typeof value === 'boolean';
      default:
        return false;
    }
  }

  public async getActiveSchema(): Promise<ICustomerSchema> {
    const schema = await CustomerSchemaModel.findOne({ isActive: true }).sort({ version: -1 });
    if (!schema) {
      // Create default schema if none exists
      return await CustomerSchemaModel.create({
        fields: [
          {
            name: 'name',
            type: 'string',
            required: true,
            isDefault: true,
            description: 'Customer name',
          },
          {
            name: 'phoneNumber',
            type: 'string',
            required: true,
            isDefault: true,
            description: 'Customer phone number',
          },
          {
            name: 'assignedAdmin',
            type: 'string',
            required: true,
            isDefault: true,
            description: 'Assigned administrator',
          },
        ],
        version: 1,
        isActive: true,
      });
    }
    return schema;
  }

  public async updateSchema(fields: ICustomField[]): Promise<ICustomerSchema> {
    // Validate default fields
    const defaultFields = ['name', 'phoneNumber', 'assignedAdmin'];
    const hasAllDefaultFields = defaultFields.every((field) =>
      fields.some((f) => f.name === field && f.isDefault),
    );

    if (!hasAllDefaultFields) {
      throw new ApiError(400, 'Cannot remove default fields');
    }

    // Get current active schema
    const currentSchema = await this.getActiveSchema();

    try {
      // Create new schema version
      const newSchema = await CustomerSchemaModel.create({
        fields,
        version: currentSchema.version + 1,
        isActive: true,
      });

      // Deactivate old schema
      await CustomerSchemaModel.findByIdAndUpdate(currentSchema._id, { isActive: false });

      return newSchema;
    } catch (error) {
      logger.error('Error updating customer schema:', error);
      throw new ApiError(500, 'Failed to update customer schema');
    }
  }

  public async createCustomer(customerData: Partial<ICustomer>): Promise<ICustomer> {
    const schema = await this.getActiveSchema();

    // Validate required fields
    for (const field of schema.fields) {
      if (field.required) {
        const value = field.isDefault
          ? customerData[field.name as keyof ICustomer]
          : customerData.customFields?.[field.name];

        if (!this.validateFieldValue(field, value)) {
          throw new ApiError(400, `Invalid or missing value for required field: ${field.name}`);
        }
      }
    }

    try {
      return await CustomerModel.create(customerData);
    } catch (error) {
      logger.error('Error creating customer:', error);
      throw new ApiError(500, 'Failed to create customer');
    }
  }

  public async updateCustomer(
    customerId: string,
    updateData: Partial<ICustomer>,
  ): Promise<ICustomer | null> {
    const schema = await this.getActiveSchema();

    // Validate fields according to schema
    for (const [key, value] of Object.entries(updateData.customFields || {})) {
      const fieldSchema = schema.fields.find((f) => f.name === key);
      if (fieldSchema && !this.validateFieldValue(fieldSchema, value)) {
        throw new ApiError(400, `Invalid value for field: ${key}`);
      }
    }

    try {
      const customer = await CustomerModel.findByIdAndUpdate(
        new Types.ObjectId(customerId),
        { $set: updateData },
        { new: true },
      );

      if (!customer) {
        throw new ApiError(404, 'Customer not found');
      }

      return customer;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error updating customer:', error);
      throw new ApiError(500, 'Failed to update customer');
    }
  }

  public async deleteCustomer(customerId: string): Promise<void> {
    try {
      const result = await CustomerModel.deleteOne({ _id: new Types.ObjectId(customerId) });
      if (result.deletedCount === 0) {
        throw new ApiError(404, 'Customer not found');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error deleting customer:', error);
      throw new ApiError(500, 'Failed to delete customer');
    }
  }

  public async getCustomerById(customerId: string): Promise<ICustomer> {
    try {
      const customer = await CustomerModel.findById(new Types.ObjectId(customerId)).populate(
        'assignedAdmin',
        'firstName lastName email',
      );

      if (!customer) {
        throw new ApiError(404, 'Customer not found');
      }

      return customer;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error fetching customer:', error);
      throw new ApiError(500, 'Failed to fetch customer');
    }
  }

  public async getCustomers(
    page = 1,
    limit = 10,
    filters: Record<string, unknown> = {},
  ): Promise<{ customers: ICustomer[]; total: number }> {
    try {
      const skip = (page - 1) * limit;
      const query = CustomerModel.find(filters)
        .populate('assignedAdmin', 'firstName lastName email')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });

      const [customers, total] = await Promise.all([
        query.exec(),
        CustomerModel.countDocuments(filters),
      ]);

      return { customers, total };
    } catch (error) {
      logger.error('Error fetching customers:', error);
      throw new ApiError(500, 'Failed to fetch customers');
    }
  }
}

export const customerService = CustomerService.getInstance();
