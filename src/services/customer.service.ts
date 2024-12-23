// src/services/customer.service.ts
import { Types } from 'mongoose';
import { CustomerStatus } from '@/types/customer.js';
import type {
  ICustomerDocument,
  CustomerResponse,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  CustomerStatistics,
  BatchOperationResult,
  CustomerGroupResponse,
  AdminDocument,
  GroupDocument,
  CreateCustomerGroupRequest,
  CustomField,
  PopulatedCustomerDocument,
  UpdateCustomerGroupRequest,
  ICustomerGroupDocument,
} from '@/types/customer.js';
import { CustomerModel, CustomerGroupModel } from '@/models/customer.model.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { auditService } from '@/services/audit.service.js';
import { logger } from '@/utils/logger.js';
import { Redis } from '@/config/redis.js';

// Define interfaces for populated documents

interface LeanCustomerGroupDocument extends Omit<ICustomerGroupDocument, 'metadata'> {
  _id: Types.ObjectId;
  metadata: Record<string, unknown>;
}

// Base type for schema values
type SchemaValue = string | number | boolean | Date | Buffer | Types.ObjectId;

// Type for constructor parameters
type ConstructorParams =
  | string
  | number
  | boolean
  | Date
  | Buffer
  | Types.ObjectId
  | Record<string, unknown>
  | undefined;

// Type definition for constructor functions
type Constructor = {
  name: string;
  new (...args: ConstructorParams[]): SchemaValue;
};

// Updated type for mongoose schema fields
interface MongooseSchemaField {
  type?: Constructor | { name: string } | Record<string, unknown>;
  required?: boolean;
  instance?: string;
  [key: string]: unknown;
}

interface SchemaFieldDefinition {
  type: string;
  required: boolean;
}

// Type guard to check if value is a constructor
function isConstructor(value: unknown): value is Constructor {
  return typeof value === 'function' && 'name' in value;
}

export class CustomerService {
  private static instance: CustomerService;
  private readonly CACHE_TTL = 300; // 5 minutes in seconds
  private readonly CACHE_PREFIX = 'customer:';
  private readonly STATISTICS_CACHE_KEY = 'customer:statistics';

  private constructor() {}

  public static getInstance(): CustomerService {
    if (!CustomerService.instance) {
      CustomerService.instance = new CustomerService();
    }
    return CustomerService.instance;
  }

  /**
   * Create a new customer with validation and caching
   */
  public async createCustomer(
    data: CreateCustomerRequest,
    userId: string,
  ): Promise<CustomerResponse> {
    try {
      const customerDoc = await CustomerModel.create({
        ...data,
        assignedAdmin: new Types.ObjectId(data.assignedAdmin),
        groups: data.groups?.map((id) => new Types.ObjectId(id)) || [],
      });

      const customer = (await customerDoc.populate([
        { path: 'assignedAdmin', select: 'email firstName lastName' },
        { path: 'groups', select: 'name description' },
      ])) as unknown as PopulatedCustomerDocument;

      await Redis.del(this.STATISTICS_CACHE_KEY);

      await this.logAuditEvent(userId, 'customer.create', 'success', {
        customerId: customer._id.toString(),
        customerName: customer.name,
      });

      return this.formatCustomerResponse(customer);
    } catch (error) {
      await this.logAuditEvent(userId, 'customer.create', 'failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data,
      });
      throw error;
    }
  }

  /**
   * Get customer by ID with caching
   */
  public async getCustomerById(id: string): Promise<CustomerResponse> {
    try {
      const cached = await Redis.get(`${this.CACHE_PREFIX}${id}`);
      if (cached) {
        return JSON.parse(cached) as CustomerResponse;
      }

      const customer = await CustomerModel.findById(id)
        .populate<{ assignedAdmin: AdminDocument }>('assignedAdmin', 'email firstName lastName')
        .populate<{ groups: GroupDocument[] }>('groups', 'name description')
        .lean();

      if (!customer) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);
      }

      // Type assertion for populated document
      const populatedCustomer = customer as unknown as {
        _id: Types.ObjectId;
        name: string;
        phoneNumber: string;
        countryCode: string;
        assignedAdmin: AdminDocument;
        status: CustomerStatus; // Updated this type
        customFields: Record<string, unknown>;
        groups: GroupDocument[];
        tags: string[];
        lastActivity: Date | null;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
      };

      // Validate status
      if (!Object.values(CustomerStatus).includes(populatedCustomer.status)) {
        throw new AppError(ErrorCode.DATA_INTEGRITY_ERROR, 'Invalid customer status', 500, false, {
          details: { status: populatedCustomer.status },
        });
      }

      // Ensure customFields and metadata are properly handled
      const customFields = new Map(Object.entries(populatedCustomer.customFields || {}));
      const metadata = new Map(Object.entries(populatedCustomer.metadata || {}));

      const response: CustomerResponse = {
        id: populatedCustomer._id.toString(),
        name: populatedCustomer.name,
        phoneNumber: populatedCustomer.phoneNumber,
        countryCode: populatedCustomer.countryCode,
        assignedAdmin: {
          id: populatedCustomer.assignedAdmin._id.toString(),
          email: populatedCustomer.assignedAdmin.email,
          firstName: populatedCustomer.assignedAdmin.firstName,
          lastName: populatedCustomer.assignedAdmin.lastName,
        },
        status: populatedCustomer.status, // This is now correctly typed as CustomerStatus
        customFields: Object.fromEntries(customFields),
        groups: populatedCustomer.groups.map((group) => ({
          id: group._id.toString(),
          name: group.name,
        })),
        tags: populatedCustomer.tags,
        lastActivity: populatedCustomer.lastActivity?.toISOString() ?? null,
        metadata: Object.fromEntries(metadata),
        createdAt: populatedCustomer.createdAt.toISOString(),
        updatedAt: populatedCustomer.updatedAt.toISOString(),
      };

      await Redis.setEx(`${this.CACHE_PREFIX}${id}`, this.CACHE_TTL, JSON.stringify(response));

      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Error retrieving customer', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Update customer with validation
   */
  public async updateCustomer(
    id: string,
    data: UpdateCustomerRequest,
    userId: string,
  ): Promise<CustomerResponse> {
    try {
      const customerDoc = await CustomerModel.findById(id);
      if (!customerDoc) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);
      }

      if (data.assignedAdmin) {
        customerDoc.assignedAdmin = new Types.ObjectId(data.assignedAdmin);
      }

      if ('groups' in data && Array.isArray(data.groups)) {
        customerDoc.groups = data.groups.map((groupId) => new Types.ObjectId(groupId));
      }

      Object.assign(customerDoc, data);
      await customerDoc.save();

      const customer = (await customerDoc.populate([
        { path: 'assignedAdmin', select: 'email firstName lastName' },
        { path: 'groups', select: 'name description' },
      ])) as unknown as PopulatedCustomerDocument;

      await Redis.del(`${this.CACHE_PREFIX}${id}`);
      await Redis.del(this.STATISTICS_CACHE_KEY);

      await this.logAuditEvent(userId, 'customer.update', 'success', {
        customerId: id,
        changes: data,
      });

      return this.formatCustomerResponse(customer);
    } catch (error) {
      await this.logAuditEvent(userId, 'customer.update', 'failure', {
        customerId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete customer with cleanup
   */
  public async deleteCustomer(id: string, userId: string): Promise<void> {
    try {
      const customer = await CustomerModel.findById(id);
      if (!customer) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer not found', 404);
      }

      await customer.deleteOne();
      await Redis.del(`${this.CACHE_PREFIX}${id}`);
      await Redis.del(this.STATISTICS_CACHE_KEY);

      await this.logAuditEvent(userId, 'customer.delete', 'success', {
        customerId: id,
        customerName: customer.name,
      });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer.delete', 'failure', {
        customerId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get customer statistics with caching
   */
  public async getStatistics(dateRange?: { start: Date; end: Date }): Promise<CustomerStatistics> {
    try {
      if (!dateRange) {
        const cached = await Redis.get(this.STATISTICS_CACHE_KEY);
        if (cached) {
          return JSON.parse(cached) as CustomerStatistics;
        }
      }

      const statistics = await CustomerModel.getStatistics(dateRange);

      if (!dateRange) {
        await Redis.setEx(this.STATISTICS_CACHE_KEY, this.CACHE_TTL, JSON.stringify(statistics));
      }

      return statistics;
    } catch (error) {
      logger.error('Error getting customer statistics:', error);
      throw new AppError(
        ErrorCode.DATABASE_ERROR,
        'Error retrieving customer statistics',
        500,
        false,
        {
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      );
    }
  }

  /**
   * Batch update customers with transaction support
   */
  public async batchUpdateCustomers(
    updates: Array<{ id: string; data: UpdateCustomerRequest }>,
    userId: string,
  ): Promise<BatchOperationResult> {
    try {
      const transformedUpdates = updates.map((update) => {
        const transformedData: Partial<ICustomerDocument> = {
          name: update.data.name,
          phoneNumber: update.data.phoneNumber,
          countryCode: update.data.countryCode,
          status: update.data.status,
          customFields: update.data.customFields
            ? new Map(Object.entries(update.data.customFields))
            : undefined,
          metadata: update.data.metadata
            ? new Map(Object.entries(update.data.metadata))
            : undefined,
        };

        if (update.data.assignedAdmin) {
          transformedData.assignedAdmin = new Types.ObjectId(update.data.assignedAdmin);
        }

        return {
          id: new Types.ObjectId(update.id),
          data: transformedData,
        };
      });

      const result = await CustomerModel.batchUpdate(transformedUpdates);

      await Promise.all([
        ...updates.map((update) => Redis.del(`${this.CACHE_PREFIX}${update.id}`)),
        Redis.del(this.STATISTICS_CACHE_KEY),
      ]);

      await this.logAuditEvent(userId, 'customer.batch-update', 'success', {
        updateCount: updates.length,
        result,
      });

      return result;
    } catch (error) {
      await this.logAuditEvent(userId, 'customer.batch-update', 'failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        updates,
      });
      throw error;
    }
  }

  /**
   * Create customer group
   */
  public async createCustomerGroup(
    data: CreateCustomerGroupRequest,
    userId: string,
  ): Promise<CustomerGroupResponse> {
    try {
      const group = await CustomerGroupModel.create({
        ...data,
        metadata: new Map(Object.entries(data.metadata || {})),
      });

      const groupId = (group._id as Types.ObjectId).toString();
      await this.logAuditEvent(userId, 'customer-group.create', 'success', {
        groupId,
        groupName: group.name,
      });

      return this.formatGroupResponse(group as ICustomerGroupDocument & { _id: Types.ObjectId });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer-group.create', 'failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data,
      });
      throw error;
    }
  }

  /**
   * Update customer group
   */
  public async updateCustomerGroup(
    id: string,
    data: UpdateCustomerGroupRequest,
    userId: string,
  ): Promise<CustomerGroupResponse> {
    try {
      const group = await CustomerGroupModel.findByIdAndUpdate(
        id,
        { $set: { ...data, metadata: new Map(Object.entries(data.metadata || {})) } },
        { new: true, runValidators: true },
      );

      if (!group) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer group not found', 404);
      }

      await this.logAuditEvent(userId, 'customer-group.update', 'success', {
        groupId: id,
        changes: data,
      });

      return this.formatGroupResponse(group as ICustomerGroupDocument & { _id: Types.ObjectId });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer-group.update', 'failure', {
        groupId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete customer group
   */
  public async deleteCustomerGroup(id: string, userId: string): Promise<void> {
    try {
      const group = await CustomerGroupModel.findById(id);
      if (!group) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer group not found', 404);
      }

      if (group.customers.length > 0) {
        throw new AppError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete group with active customers',
          400,
          true,
          { details: { customerCount: group.customers.length } },
        );
      }

      await group.deleteOne();

      await this.logAuditEvent(userId, 'customer-group.delete', 'success', {
        groupId: id,
        groupName: group.name,
      });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer-group.delete', 'failure', {
        groupId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get customer group by ID
   */
  public async getCustomerGroupById(id: string): Promise<CustomerGroupResponse> {
    try {
      const group = await CustomerGroupModel.findById(id);
      if (!group) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer group not found', 404);
      }

      return this.formatGroupResponse(group as ICustomerGroupDocument & { _id: Types.ObjectId });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Error retrieving customer group', 500, false, {
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  /**
   * List customer groups with proper type handling
   * @param page - Page number for pagination
   * @param limit - Number of items per page
   * @param search - Optional search string
   * @returns Paginated list of customer groups with total count
   */
  public async listCustomerGroups(
    page = 1,
    limit = 10,
    search?: string,
  ): Promise<{ groups: CustomerGroupResponse[]; total: number; pages: number }> {
    try {
      const query = search
        ? {
            $or: [{ name: new RegExp(search, 'i') }, { description: new RegExp(search, 'i') }],
          }
        : {};

      const [groups, total] = await Promise.all([
        CustomerGroupModel.find(query)
          .skip((page - 1) * limit)
          .limit(limit)
          .sort({ name: 1 })
          .lean<LeanCustomerGroupDocument[]>(),
        CustomerGroupModel.countDocuments(query),
      ]);

      return {
        groups: groups.map((group) =>
          this.formatGroupResponse({
            ...group,
            metadata: new Map(Object.entries(group.metadata || {})),
          } as ICustomerGroupDocument & { _id: Types.ObjectId }),
        ),
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Error retrieving customer groups', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          page,
          limit,
          search,
        },
      });
    }
  }

  /**
   * Add customers to group
   */
  public async addCustomersToGroup(
    groupId: string,
    customerIds: string[],
    userId: string,
  ): Promise<CustomerGroupResponse> {
    try {
      const group = await CustomerGroupModel.findById(groupId);
      if (!group) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer group not found', 404);
      }

      // Validate customers exist
      const customerObjectIds = customerIds.map((id) => new Types.ObjectId(id));
      const customers = await CustomerModel.find({
        _id: { $in: customerObjectIds },
      }).select('_id');

      const foundCustomerIds = customers.map((c) => c._id as Types.ObjectId);
      if (foundCustomerIds.length !== customerIds.length) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Some customers were not found', 400, true, {
          details: {
            providedIds: customerIds,
            foundIds: foundCustomerIds.map((id) => id.toString()),
          },
        });
      }

      // Add customers to group
      const uniqueCustomerIds = [
        ...new Set([
          ...group.customers.map((id) => id.toString()),
          ...foundCustomerIds.map((id) => id.toString()),
        ]),
      ].map((id) => new Types.ObjectId(id));

      group.customers = uniqueCustomerIds;
      await group.save();

      // Update customers
      await CustomerModel.updateMany(
        { _id: { $in: foundCustomerIds } },
        { $addToSet: { groups: group._id } },
      );

      await this.logAuditEvent(userId, 'customer-group.add-customers', 'success', {
        groupId,
        customerIds,
      });

      return this.formatGroupResponse(group as ICustomerGroupDocument & { _id: Types.ObjectId });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer-group.add-customers', 'failure', {
        groupId,
        customerIds,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Remove customers from group
   */
  public async removeCustomersFromGroup(
    groupId: string,
    customerIds: string[],
    userId: string,
  ): Promise<CustomerGroupResponse> {
    try {
      const group = await CustomerGroupModel.findById(groupId);
      if (!group) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Customer group not found', 404);
      }

      const customerObjectIds = customerIds.map((id) => new Types.ObjectId(id));

      // Remove customers from group
      group.customers = group.customers.filter(
        (id) => !customerObjectIds.some((custId) => custId.equals(id)),
      );
      await group.save();

      // Update customers
      await CustomerModel.updateMany(
        { _id: { $in: customerObjectIds } },
        { $pull: { groups: group._id } },
      );

      await this.logAuditEvent(userId, 'customer-group.remove-customers', 'success', {
        groupId,
        customerIds,
      });

      return this.formatGroupResponse(group as ICustomerGroupDocument & { _id: Types.ObjectId });
    } catch (error) {
      await this.logAuditEvent(userId, 'customer-group.remove-customers', 'failure', {
        groupId,
        customerIds,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Format customer response with proper type casting
   */
  private formatCustomerResponse(customer: PopulatedCustomerDocument): CustomerResponse {
    return {
      id: customer._id.toString(),
      name: customer.name,
      phoneNumber: customer.phoneNumber,
      countryCode: customer.countryCode,
      assignedAdmin: {
        id: customer.assignedAdmin._id.toString(),
        email: customer.assignedAdmin.email,
        firstName: customer.assignedAdmin.firstName,
        lastName: customer.assignedAdmin.lastName,
      },
      status: customer.status,
      customFields: Object.fromEntries(customer.customFields),
      groups: customer.groups.map((group) => ({
        id: group._id.toString(),
        name: group.name,
      })),
      tags: customer.tags,
      lastActivity: customer.lastActivity?.toISOString() ?? null,
      metadata: Object.fromEntries(
        customer.metadata instanceof Map ? customer.metadata : new Map(),
      ),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  /**
   * Get current customer schema fields and list customers with pagination
   */
  public async listCustomers(
    page = 1,
    limit = 10,
  ): Promise<{
    schema: {
      baseFields: Record<string, SchemaFieldDefinition>;
      customFields: CustomField[];
    };
    customers: CustomerResponse[];
    total: number;
    pages: number;
  }> {
    try {
      const baseSchema = CustomerModel.schema.obj;
      const baseFields = Object.entries(baseSchema).reduce<Record<string, SchemaFieldDefinition>>(
        (acc, [key, value]) => {
          // Skip internal fields and complex types
          if (
            key === '_id' ||
            key === '__v' ||
            key === 'customFields' ||
            key === 'metadata' ||
            key === 'groups' ||
            key === 'tags'
          ) {
            return acc;
          }

          // Ensure value is a valid schema field
          const schemaField = value as MongooseSchemaField;

          acc[key] = {
            type: this.getSchemaType(schemaField),
            required: this.isFieldRequired(schemaField),
          };
          return acc;
        },
        {},
      );

      // Get custom fields
      const allGroups = await CustomerGroupModel.find().select('customFields').lean();
      const customFields = Array.from(
        new Map(
          allGroups.flatMap((group) => group.customFields).map((field) => [field.name, field]),
        ).values(),
      );

      // Get customers with pagination
      const [customers, total] = await Promise.all([
        CustomerModel.find()
          .populate<{ assignedAdmin: AdminDocument }>('assignedAdmin', 'email firstName lastName')
          .populate<{ groups: GroupDocument[] }>('groups', 'name description')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<PopulatedCustomerDocument[]>(),
        CustomerModel.countDocuments(),
      ]);

      return {
        schema: {
          baseFields,
          customFields,
        },
        customers: customers.map((customer) => this.formatCustomerResponse(customer)),
        total,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Error listing customers', 500, false, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Helper method to get schema type
   */
  private getSchemaType(schemaField: MongooseSchemaField): string {
    if (schemaField === null || schemaField === undefined) {
      return 'unknown';
    }

    // Handle direct constructor type
    if (isConstructor(schemaField)) {
      return schemaField.name.toLowerCase();
    }

    // Handle schema field object
    if (typeof schemaField === 'object') {
      // Handle type property if it exists
      if ('type' in schemaField && schemaField.type) {
        const fieldType = schemaField.type;

        // Handle constructor type
        if (isConstructor(fieldType)) {
          return fieldType.name.toLowerCase();
        }

        // Handle object type with name property
        if (typeof fieldType === 'object' && fieldType !== null && 'name' in fieldType) {
          return (fieldType as { name: string }).name.toLowerCase();
        }
      }

      // Handle instance property
      if ('instance' in schemaField && typeof schemaField.instance === 'string') {
        return schemaField.instance.toLowerCase();
      }
    }

    return 'unknown';
  }

  /**
   * Helper method to check if field is required
   */
  private isFieldRequired(schemaField: MongooseSchemaField): boolean {
    if (typeof schemaField === 'object' && schemaField !== null) {
      return schemaField.required === true;
    }
    return false;
  }

  /**
   * Format group response with proper type conversion
   * @param group - Customer group document
   * @returns Formatted customer group response
   */
  private formatGroupResponse(
    group: ICustomerGroupDocument & { _id: Types.ObjectId },
  ): CustomerGroupResponse {
    // Ensure metadata is a Map instance
    const metadata =
      group.metadata instanceof Map
        ? group.metadata
        : new Map(Object.entries(group.metadata || {}));

    return {
      id: group._id.toString(),
      name: group.name,
      description: group.description,
      customFields: group.customFields,
      customersCount: group.customers.length,
      metadata: Object.fromEntries(metadata),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  /**
   * Helper method to log audit events
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
}

export const customerService = CustomerService.getInstance();
