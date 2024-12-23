// src/controllers/customer.controller.ts
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@/types/auth.js';
import type {
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CreateCustomerGroupRequest,
  UpdateCustomerGroupRequest,
} from '@/types/customer.js';
import { customerService } from '@/services/customer.service.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';

// Define request parameter interfaces
interface RequestWithId {
  id: string;
}

interface BatchUpdateRequest {
  updates: Array<{ id: string; data: UpdateCustomerRequest }>;
}

interface GroupCustomersRequest {
  customerIds: string[];
}

/**
 * Controller handling customer-related operations with proper error handling and type safety
 */
export class CustomerController {
  /**
   * Create a new customer
   * @route POST /api/customers
   */
  public createCustomer = async (
    req: AuthenticatedRequest & { body: CreateCustomerRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const customer = await customerService.createCustomer(req.body, userId);
    successResponse(res, customer, 'Customer created successfully', 201);
  };

  /**
   * Get customer by ID
   * @route GET /api/customers/:id
   */
  public getCustomerById = async (
    req: AuthenticatedRequest & { params: RequestWithId },
    res: Response,
  ): Promise<void> => {
    const customer = await customerService.getCustomerById(req.params.id);
    successResponse(res, customer);
  };

  /**
   * Update customer
   * @route PUT /api/customers/:id
   */
  public updateCustomer = async (
    req: AuthenticatedRequest & { params: RequestWithId; body: UpdateCustomerRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const customer = await customerService.updateCustomer(req.params.id, req.body, userId);
    successResponse(res, customer, 'Customer updated successfully');
  };

  /**
   * Delete customer
   * @route DELETE /api/customers/:id
   */
  public deleteCustomer = async (
    req: AuthenticatedRequest & { params: RequestWithId },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    await customerService.deleteCustomer(req.params.id, userId);
    successResponse(res, null, 'Customer deleted successfully', 204);
  };

  /**
   * Get customer statistics
   * @route GET /api/customers/statistics
   */
  public getStatistics = async (
    req: AuthenticatedRequest & {
      query: { fromDate?: string; toDate?: string };
    },
    res: Response,
  ): Promise<void> => {
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : undefined;
    const toDate = req.query.toDate ? new Date(req.query.toDate) : undefined;

    const dateRange = fromDate && toDate ? { start: fromDate, end: toDate } : undefined;
    const statistics = await customerService.getStatistics(dateRange);

    successResponse(res, statistics);
  };

  /**
   * Batch update customers
   * @route PATCH /api/customers/batch
   */
  public batchUpdateCustomers = async (
    req: AuthenticatedRequest & { body: BatchUpdateRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const result = await customerService.batchUpdateCustomers(req.body.updates, userId);
    successResponse(res, result, 'Customers updated successfully');
  };

  /**
   * Create customer group
   * @route POST /api/customers/groups
   */
  public createCustomerGroup = async (
    req: AuthenticatedRequest & { body: CreateCustomerGroupRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const group = await customerService.createCustomerGroup(req.body, userId);
    successResponse(res, group, 'Customer group created successfully', 201);
  };

  /**
   * Update customer group
   * @route PUT /api/customers/groups/:id
   */
  public updateCustomerGroup = async (
    req: AuthenticatedRequest & {
      params: RequestWithId;
      body: UpdateCustomerGroupRequest;
    },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const group = await customerService.updateCustomerGroup(req.params.id, req.body, userId);
    successResponse(res, group, 'Customer group updated successfully');
  };

  /**
   * Delete customer group
   * @route DELETE /api/customers/groups/:id
   */
  public deleteCustomerGroup = async (
    req: AuthenticatedRequest & { params: RequestWithId },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    await customerService.deleteCustomerGroup(req.params.id, userId);
    successResponse(res, null, 'Customer group deleted successfully', 204);
  };

  /**
   * Get customer group by ID
   * @route GET /api/customers/groups/:id
   */
  public getCustomerGroupById = async (
    req: AuthenticatedRequest & { params: RequestWithId },
    res: Response,
  ): Promise<void> => {
    const group = await customerService.getCustomerGroupById(req.params.id);
    successResponse(res, group);
  };

  /**
   * List customer groups
   * @route GET /api/customers/groups
   */
  public listCustomerGroups = async (
    req: AuthenticatedRequest & {
      query: { page?: string; limit?: string; search?: string };
    },
    res: Response,
  ): Promise<void> => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search;

    const groups = await customerService.listCustomerGroups(page, limit, search);
    successResponse(res, groups);
  };

  /**
   * Add customers to group
   * @route POST /api/customers/groups/:id/customers
   */
  public addCustomersToGroup = async (
    req: AuthenticatedRequest & { params: RequestWithId; body: GroupCustomersRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const group = await customerService.addCustomersToGroup(
      req.params.id,
      req.body.customerIds,
      userId,
    );
    successResponse(res, group, 'Customers added to group successfully');
  };

  /**
   * Remove customers from group
   * @route DELETE /api/customers/groups/:id/customers
   */
  public removeCustomersFromGroup = async (
    req: AuthenticatedRequest & { params: RequestWithId; body: GroupCustomersRequest },
    res: Response,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    const group = await customerService.removeCustomersFromGroup(
      req.params.id,
      req.body.customerIds,
      userId,
    );
    successResponse(res, group, 'Customers removed from group successfully');
  };
}
