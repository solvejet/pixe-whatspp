// src/controllers/customer.controller.ts

import type { Response } from 'express';
import type { AuthenticatedRequest } from '@/types/auth.js';
import { customerService } from '@/services/customer.service.js';
import type { ICustomer, ICustomerSchema, ICustomField } from '@/types/customer.js';

export class CustomerController {
  async getSchema(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const schema = await customerService.getActiveSchema();
    res.json(schema);
  }

  async updateSchema(
    req: AuthenticatedRequest<unknown, ICustomerSchema, { fields: ICustomField[] }>,
    res: Response,
  ): Promise<void> {
    const updatedSchema = await customerService.updateSchema(req.body.fields);
    res.json(updatedSchema);
  }

  async createCustomer(
    req: AuthenticatedRequest<unknown, ICustomer, Partial<ICustomer>>,
    res: Response,
  ): Promise<void> {
    const customer = await customerService.createCustomer(req.body);
    res.status(201).json(customer);
  }

  async getCustomers(
    req: AuthenticatedRequest,
    res: Response<{ customers: ICustomer[]; total: number }>,
  ): Promise<void> {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const filters = (req.query.filters as Record<string, unknown>) || {};

    const result = await customerService.getCustomers(page, limit, filters);
    res.json(result);
  }

  async getCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const customer = await customerService.getCustomerById(req.params.id);
    res.json(customer);
  }

  async updateCustomer(
    req: AuthenticatedRequest<{ id: string }, ICustomer, Partial<ICustomer>>,
    res: Response,
  ): Promise<void> {
    const customer = await customerService.updateCustomer(req.params.id, req.body);
    res.json(customer);
  }

  async deleteCustomer(
    req: AuthenticatedRequest<{ id: string }>,
    res: Response<{ message: string }>,
  ): Promise<void> {
    await customerService.deleteCustomer(req.params.id);
    res.json({ message: 'Customer deleted successfully' });
  }
}
