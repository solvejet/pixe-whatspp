// src/controllers/customer.controller.ts
import type { Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '@/middleware/error-handler.js';
import type { TypedAuthRequest } from '@/types/auth.js';
import { customerService } from '@/services/customer.service.js';
import type { ICustomerSchema, ICustomerPopulated } from '@/types/customer.js';
import type {
  SchemaUpdateBody,
  CustomerCreateBody,
  CustomerUpdateBody,
  CustomerQueryParams,
  CustomerFilters,
  CustomerBulkUpdateBody,
} from '@/types/customer-requests.js';
import { logger } from '@/utils/logger.js';

export class CustomerController {
  /**
   * Get active customer schema
   */
  async getSchema(
    _req: TypedAuthRequest,
    res: Response<{ data: ICustomerSchema; message: string }>,
  ): Promise<void> {
    const schema = await customerService.getActiveSchema();
    res.json({
      data: schema,
      message: 'Customer schema retrieved successfully',
    });
  }

  /**
   * Update customer schema
   */
  async updateSchema(
    req: TypedAuthRequest<SchemaUpdateBody>,
    res: Response<{ data: ICustomerSchema; message: string }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    const fieldsWithTimestamps = req.body.fields.map((field) => ({
      ...field,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const updatedSchema = await customerService.updateSchema(fieldsWithTimestamps, req.user);
    res.json({
      data: updatedSchema,
      message: 'Customer schema updated successfully',
    });
  }

  /**
   * Create new customer
   */
  async createCustomer(
    req: TypedAuthRequest<CustomerCreateBody>,
    res: Response<{ data: ICustomerPopulated; message: string }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    const { assignedAdmin, ...customerData } = req.body;

    const customer = await customerService.createCustomer({
      ...customerData,
      assignedAdmin: new Types.ObjectId(assignedAdmin),
      metadata: {
        lastUpdatedBy: new Types.ObjectId(req.user.userId),
        source: 'api',
      },
    });

    res.status(201).json({
      data: customer,
      message: 'Customer created successfully',
    });
  }

  /**
   * Get customers with pagination and filters
   */
  async getCustomers(
    req: TypedAuthRequest<never, never, CustomerQueryParams>,
    res: Response<{
      data: {
        customers: ICustomerPopulated[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
      message: string;
    }>,
  ): Promise<void> {
    const {
      page = '1',
      limit = '10',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      assignedAdmin,
      fromDate,
      toDate,
      status,
      tags,
      format,
    } = req.query;

    // Handle export request
    if (format) {
      return this.exportCustomers(req, res);
    }

    // Add type checking for format
    if (format && format !== 'csv' && format !== 'xlsx') {
      throw new ApiError(400, 'Invalid export format. Supported formats: csv, xlsx');
    }

    const filters: CustomerFilters = {};

    if (search) {
      filters.name = { $regex: search, $options: 'i' };
    }

    if (assignedAdmin) {
      filters.assignedAdmin = new Types.ObjectId(assignedAdmin);
    }

    if (fromDate || toDate) {
      filters.createdAt = {};
      if (fromDate) {
        filters.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        filters.createdAt.$lte = new Date(toDate);
      }
    }

    if (status) {
      filters.status = status;
    }

    if (tags && Array.isArray(tags)) {
      filters.tags = { $in: tags };
    }

    const pageNumber = Math.max(parseInt(page), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit), 1), 100); // Add upper limit for security

    const { customers, total } = await customerService.getCustomers(
      pageNumber,
      limitNumber,
      filters,
      {
        sortBy,
        sortOrder: sortOrder as 'asc' | 'desc',
      },
    );

    res.json({
      data: {
        customers,
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
      message: 'Customers retrieved successfully',
    });
  }

  /**
   * Get single customer by ID
   */
  async getCustomer(
    req: TypedAuthRequest<never, { id: string }>,
    res: Response<{ data: ICustomerPopulated; message: string }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    const customer = await customerService.getCustomerById(req.params.id);

    res.json({
      data: customer,
      message: 'Customer retrieved successfully',
    });
  }

  /**
   * Update customer
   */
  async updateCustomer(
    req: TypedAuthRequest<CustomerUpdateBody, { id: string }>,
    res: Response<{ data: ICustomerPopulated; message: string }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    const { assignedAdmin, ...restBody } = req.body;
    const updateData = {
      ...restBody,
      ...(assignedAdmin && { assignedAdmin: new Types.ObjectId(assignedAdmin) }),
    };

    const customer = await customerService.updateCustomer(req.params.id, updateData, req.user);

    res.json({
      data: customer,
      message: 'Customer updated successfully',
    });
  }

  /**
   * Delete customer
   */
  async deleteCustomer(
    req: TypedAuthRequest<never, { id: string }>,
    res: Response<{ message: string }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    await customerService.deleteCustomer(req.params.id, req.user);
    res.json({ message: 'Customer deleted successfully' });
  }

  /**
   * Bulk update customers
   */
  async bulkUpdateCustomers(
    req: TypedAuthRequest<CustomerBulkUpdateBody>,
    res: Response<{ message: string; updated: number }>,
  ): Promise<void> {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    const { ids, updates } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ApiError(400, 'No customer IDs provided');
    }

    const { assignedAdmin, ...restUpdates } = updates;
    const updateData = {
      ...restUpdates,
      ...(assignedAdmin && { assignedAdmin: new Types.ObjectId(assignedAdmin) }),
    };

    const updatedCount = await customerService.bulkUpdateCustomers(ids, updateData, req.user);

    res.json({
      message: 'Customers updated successfully',
      updated: updatedCount,
    });
  }

  /**
   * Export customers
   */
  private async exportCustomers(
    req: TypedAuthRequest<never, never, CustomerQueryParams>,
    res: Response,
  ): Promise<void> {
    const { format = 'csv', search, assignedAdmin, fromDate, toDate, status, tags } = req.query;

    if (format !== 'csv' && format !== 'xlsx') {
      throw new ApiError(400, 'Invalid export format. Supported formats: csv, xlsx');
    }

    const filters: CustomerFilters = {};

    if (search) {
      filters.name = { $regex: search, $options: 'i' };
    }

    if (assignedAdmin) {
      filters.assignedAdmin = new Types.ObjectId(assignedAdmin);
    }

    if (status) {
      filters.status = status;
    }

    if (tags && Array.isArray(tags)) {
      filters.tags = { $in: tags };
    }

    if (fromDate || toDate) {
      filters.createdAt = {};
      if (fromDate) {
        filters.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        filters.createdAt.$lte = new Date(toDate);
      }
    }

    try {
      const data = await customerService.exportCustomers(filters, format);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `customers-export-${timestamp}.${format}`;
      const contentType =
        format === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(data);
    } catch (error) {
      logger.error('Export failed:', error);
      throw new ApiError(500, 'Export failed. Please try again.');
    }
  }

  /**
   * Get customer statistics
   */
  async getStatistics(
    req: TypedAuthRequest,
    res: Response<{
      data: {
        total: number;
        active: number;
        inactive: number;
        new30Days: number;
        statusDistribution: Record<string, number>;
      };
      message: string;
    }>,
  ): Promise<void> {
    const stats = await customerService.getStatistics();
    res.json({
      data: stats,
      message: 'Customer statistics retrieved successfully',
    });
  }
}
