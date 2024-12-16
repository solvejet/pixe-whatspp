import { Types } from 'mongoose';
import { Parser as CSVParser } from 'json2csv';
import type { FieldInfo } from 'json2csv';
import * as ExcelJS from 'exceljs';
import { CustomerModel, CustomerSchemaModel } from '@/models/customer.model.js';
import type {
  ICustomField,
  ICustomer,
  ICustomerPopulated,
  ICustomerSchema,
  CustomerStatus,
  CustomerFilters,
  LeanDocument,
} from '@/types/customer.js';
import { ApiError } from '@/middleware/error-handler.js';
import { logger } from '@/utils/logger.js';
import { Redis } from '@/config/redis.js';
import { auditService } from '@/services/audit.service.js';
import type { ITokenPayload } from '@/types/auth.js';

interface SortOptions {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

interface PopulatedAdmin {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
}

interface PopulatedCustomer {
  _id: Types.ObjectId | string | { toString(): string };
  name: string;
  phoneNumber: {
    countryCode: string;
    number: string;
  };
  assignedAdmin: {
    _id: Types.ObjectId | string | { toString(): string };
    firstName: string;
    lastName: string;
    email: string;
  };
  customFields?: Record<string, unknown>;
  isActive: boolean;
  status: CustomerStatus;
  tags?: string[];
  notes?: string;
  metadata: {
    lastUpdatedBy: Types.ObjectId | string | { toString(): string };
    source: string;
    importId?: string;
  };
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
}

export class CustomerService {
  private static instance: CustomerService;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly EXPORT_CHUNK_SIZE = 1000;
  private readonly MAX_BATCH_SIZE = 500;

  private constructor() {}

  public static getInstance(): CustomerService {
    if (!CustomerService.instance) {
      CustomerService.instance = new CustomerService();
    }
    return CustomerService.instance;
  }

  private async getCachedSchema(): Promise<ICustomerSchema | null> {
    try {
      const cachedSchema = await Redis.get('active_customer_schema');
      return cachedSchema ? (JSON.parse(cachedSchema) as ICustomerSchema) : null;
    } catch (error) {
      logger.error('Error getting cached schema:', error);
      return null;
    }
  }

  public async createCustomer(data: {
    name: string;
    phoneNumber: {
      countryCode: string;
      number: string;
    };
    assignedAdmin: Types.ObjectId;
    customFields?: Record<string, unknown>;
    status?: CustomerStatus;
    tags?: string[];
    notes?: string;
    metadata: {
      lastUpdatedBy: Types.ObjectId;
      source: string;
      importId?: string;
    };
  }): Promise<ICustomerPopulated> {
    try {
      // Validate against active schema
      const schema = await this.getActiveSchema();

      // Validate custom fields against schema
      if (data.customFields) {
        for (const [key, value] of Object.entries(data.customFields)) {
          const fieldSchema = schema.fields.find((f) => f.name === key);
          if (!fieldSchema) {
            throw new ApiError(400, `Unknown custom field: ${key}`);
          }
          if (!this.validateFieldValue(fieldSchema, value)) {
            throw new ApiError(400, `Invalid value for field: ${key}`);
          }
        }
      }

      // Create the customer
      const doc = await CustomerModel.create(data);

      // Populate the assigned admin
      const populatedDoc = await CustomerModel.findById(doc._id)
        .populate<{ assignedAdmin: PopulatedAdmin }>('assignedAdmin', 'firstName lastName email')
        .lean()
        .exec();

      if (!populatedDoc) {
        throw new ApiError(500, 'Failed to retrieve created customer');
      }

      // Type assertion after verifying the shape
      const typedDoc = populatedDoc as unknown as PopulatedCustomer;
      if (
        !typedDoc.assignedAdmin?.firstName ||
        !typedDoc.assignedAdmin?.lastName ||
        !typedDoc.assignedAdmin?.email
      ) {
        throw new ApiError(500, 'Failed to populate customer data');
      }

      const customer = this.convertToCustomerPopulated(typedDoc);

      // Clear relevant cache entries
      await Redis.del('customers:list:*');

      // Log the creation
      await auditService.log({
        userId: data.metadata.lastUpdatedBy.toString(),
        action: 'customer.create',
        category: 'data',
        details: {
          customerId: customer._id,
          data: {
            name: data.name,
            assignedAdmin: data.assignedAdmin,
            status: data.status,
          },
        },
        ipAddress: 'system',
        userAgent: 'system',
        status: 'success',
      });

      return customer;
    } catch (error) {
      logger.error('Error creating customer:', error);
      throw error instanceof ApiError ? error : new ApiError(500, 'Failed to create customer');
    }
  }

  public async getStatistics(): Promise<{
    total: number;
    active: number;
    inactive: number;
    new30Days: number;
    statusDistribution: Record<string, number>;
  }> {
    try {
      const cacheKey = 'customer:statistics';
      const cached = await Redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as {
          total: number;
          active: number;
          inactive: number;
          new30Days: number;
          statusDistribution: Record<string, number>;
        };
      }

      const [total, active, inactive, statusDistribution, new30Days] = await Promise.all([
        CustomerModel.countDocuments(),
        CustomerModel.countDocuments({ isActive: true }),
        CustomerModel.countDocuments({ isActive: false }),
        CustomerModel.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ]),
        CustomerModel.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }),
      ]);

      const stats = {
        total,
        active,
        inactive,
        new30Days,
        statusDistribution: statusDistribution.reduce(
          (acc, curr) => ({
            ...acc,
            [curr._id]: curr.count,
          }),
          {} as Record<string, number>,
        ),
      };

      // Cache for 5 minutes
      await Redis.set(cacheKey, JSON.stringify(stats), 300);

      return stats;
    } catch (error) {
      logger.error('Error getting customer statistics:', error);
      throw new ApiError(500, 'Failed to retrieve customer statistics');
    }
  }

  public async getCustomerById(customerId: string): Promise<ICustomerPopulated> {
    try {
      // Try to get from cache first
      const cacheKey = `customers:${customerId}`;
      const cached = await Redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ICustomerPopulated;
      }

      // If not in cache, get from database
      const doc = await CustomerModel.findById(new Types.ObjectId(customerId))
        .populate<{ assignedAdmin: PopulatedAdmin }>('assignedAdmin', 'firstName lastName email')
        .lean()
        .exec();

      if (!doc) {
        throw new ApiError(404, 'Customer not found');
      }

      // Type assertion after verifying the shape
      const populatedDoc = doc as unknown as PopulatedCustomer;
      if (
        !populatedDoc.assignedAdmin?.firstName ||
        !populatedDoc.assignedAdmin?.lastName ||
        !populatedDoc.assignedAdmin?.email
      ) {
        throw new ApiError(500, 'Failed to populate customer data');
      }

      const customer = this.convertToCustomerPopulated(populatedDoc);

      // Cache for 5 minutes
      await Redis.set(cacheKey, JSON.stringify(customer), 300);

      return customer;
    } catch (error) {
      logger.error('Error getting customer by ID:', error);
      throw error instanceof ApiError ? error : new ApiError(500, 'Failed to retrieve customer');
    }
  }

  private async setCachedSchema(schema: ICustomerSchema): Promise<void> {
    try {
      await Redis.set('active_customer_schema', JSON.stringify(schema), this.CACHE_TTL);
    } catch (error) {
      logger.error('Error setting cached schema:', error);
    }
  }

  private validateFieldValue(field: ICustomField, value: unknown): boolean {
    if (field.required && (value === null || value === undefined)) {
      return false;
    }

    if (value === null || value === undefined) {
      return true;
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

  private convertToCustomerPopulated(doc: PopulatedCustomer): ICustomerPopulated {
    // Helper function to safely convert to ObjectId
    const toObjectId = (value: unknown): Types.ObjectId => {
      if (value instanceof Types.ObjectId) {
        return value;
      }
      if (typeof value === 'string') {
        return new Types.ObjectId(value);
      }
      if (value && typeof value === 'object' && 'toString' in value) {
        return new Types.ObjectId(value.toString());
      }
      throw new ApiError(500, 'Invalid ObjectId value');
    };

    // Helper function to safely convert to Date
    const toDate = (value: unknown): Date => {
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new ApiError(500, 'Invalid date value');
        }
        return date;
      }
      throw new ApiError(500, 'Invalid date value');
    };

    try {
      return {
        _id: toObjectId(doc._id),
        name: doc.name,
        phoneNumber: {
          countryCode: doc.phoneNumber.countryCode,
          number: doc.phoneNumber.number,
        },
        assignedAdmin: {
          _id: toObjectId(doc.assignedAdmin._id),
          firstName: doc.assignedAdmin.firstName,
          lastName: doc.assignedAdmin.lastName,
          email: doc.assignedAdmin.email,
        },
        customFields: doc.customFields || {},
        isActive: Boolean(doc.isActive),
        status: doc.status,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        notes: doc.notes,
        metadata: {
          lastUpdatedBy: toObjectId(doc.metadata.lastUpdatedBy),
          source: doc.metadata.source,
          importId: doc.metadata.importId,
        },
        createdAt: toDate(doc.createdAt),
        updatedAt: toDate(doc.updatedAt),
      };
    } catch (error) {
      logger.error('Error converting customer document:', error);
      throw error instanceof ApiError
        ? error
        : new ApiError(500, 'Failed to convert customer document');
    }
  }

  public async getActiveSchema(): Promise<ICustomerSchema> {
    try {
      const cachedSchema = await this.getCachedSchema();
      if (cachedSchema) {
        return cachedSchema;
      }

      const schema = await CustomerSchemaModel.findOne({ isActive: true })
        .sort({ version: -1 })
        .lean<ICustomerSchema>()
        .exec();

      if (!schema) {
        // Create default schema
        const defaultFields: ICustomField[] = [
          {
            name: 'name',
            type: 'string',
            required: true,
            isDefault: true,
            description: 'Customer name',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            name: 'phoneNumber',
            type: 'string',
            required: true,
            isDefault: true,
            description: 'Customer phone number',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            name: 'status',
            type: 'select',
            required: true,
            isDefault: true,
            options: ['active', 'inactive', 'pending', 'archived', 'blocked'],
            description: 'Customer status',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        const defaultSchema = await CustomerSchemaModel.create({
          fields: defaultFields,
          version: 1,
          isActive: true,
          metadata: {
            lastUpdatedBy: new Types.ObjectId(),
            changes: [],
          },
        });

        // Convert to plain object and ensure type safety
        const schemaDoc: ICustomerSchema = {
          _id: defaultSchema._id,
          fields: defaultSchema.fields,
          version: defaultSchema.version,
          isActive: defaultSchema.isActive,
          metadata: {
            lastUpdatedBy: defaultSchema.metadata.lastUpdatedBy,
            changes: defaultSchema.metadata.changes,
          },
          createdAt: defaultSchema.createdAt,
          updatedAt: defaultSchema.updatedAt,
        };

        await this.setCachedSchema(schemaDoc);
        return schemaDoc;
      }

      // Ensure the found schema matches our interface
      const validatedSchema: ICustomerSchema = {
        _id: schema._id,
        fields: schema.fields,
        version: schema.version,
        isActive: schema.isActive,
        metadata: {
          lastUpdatedBy: schema.metadata.lastUpdatedBy,
          changes: schema.metadata.changes,
        },
        createdAt: schema.createdAt,
        updatedAt: schema.updatedAt,
      };

      await this.setCachedSchema(validatedSchema);
      return validatedSchema;
    } catch (error) {
      logger.error('Error getting active schema:', error);
      throw new ApiError(500, 'Failed to get customer schema');
    }
  }

  public async getCustomers(
    page = 1,
    limit = 10,
    filters: CustomerFilters = {},
    sort: SortOptions = { sortBy: 'createdAt', sortOrder: 'desc' },
  ): Promise<{ customers: ICustomerPopulated[]; total: number }> {
    try {
      const cacheKey = `customers:list:${page}:${limit}:${JSON.stringify(filters)}:${JSON.stringify(sort)}`;
      const cachedResult = await Redis.get(cacheKey);

      if (cachedResult) {
        return JSON.parse(cachedResult) as { customers: ICustomerPopulated[]; total: number };
      }

      const skip = (page - 1) * limit;
      const sortDirection = sort.sortOrder === 'desc' ? -1 : 1;

      const [docs, total] = await Promise.all([
        CustomerModel.find(filters)
          .populate<{ assignedAdmin: PopulatedCustomer['assignedAdmin'] }>(
            'assignedAdmin',
            'firstName lastName email',
          )
          .skip(skip)
          .limit(limit)
          .sort({ [sort.sortBy]: sortDirection })
          .lean()
          .exec(),
        CustomerModel.countDocuments(filters),
      ]);

      const customers = docs.map((doc) => {
        const typedDoc = doc as PopulatedCustomer;
        return this.convertToCustomerPopulated(typedDoc);
      });

      const result = { customers, total };

      await Redis.set(cacheKey, JSON.stringify(result), this.CACHE_TTL);
      return result;
    } catch (error) {
      logger.error('Error fetching customers:', error);
      throw new ApiError(500, 'Failed to fetch customers');
    }
  }

  private async generateCSV(customers: ICustomerPopulated[]): Promise<Buffer> {
    // Explicitly type the field configurations
    const fields: FieldInfo<ICustomerPopulated>[] = [
      {
        label: 'Customer ID',
        value: 'id',
        default: '_id',
      },
      {
        label: 'Name',
        value: 'name',
      },
      {
        label: 'Phone Number',
        value: (row: ICustomerPopulated) =>
          `${row.phoneNumber.countryCode}${row.phoneNumber.number}`,
      },
      {
        label: 'Admin Email',
        value: 'assignedAdmin.email',
      },
      {
        label: 'Admin Name',
        value: (row: ICustomerPopulated) =>
          `${row.assignedAdmin.firstName} ${row.assignedAdmin.lastName}`,
      },
      {
        label: 'Status',
        value: 'status',
      },
      {
        label: 'Active',
        value: (row: ICustomerPopulated) => (row.isActive ? 'Yes' : 'No'),
      },
      {
        label: 'Tags',
        value: (row: ICustomerPopulated) => row.tags?.join(', ') || '',
      },
      {
        label: 'Notes',
        value: 'notes',
      },
      {
        label: 'Created At',
        value: (row: ICustomerPopulated) => row.createdAt.toISOString(),
      },
      {
        label: 'Updated At',
        value: (row: ICustomerPopulated) => row.updatedAt.toISOString(),
      },
      {
        label: 'Source',
        value: 'metadata.source',
      },
    ];

    // Add custom fields
    const customFields = new Set<string>();
    customers.forEach((customer) => {
      if (customer.customFields) {
        Object.keys(customer.customFields).forEach((key) => customFields.add(key));
      }
    });

    const allFields: FieldInfo<ICustomerPopulated>[] = [
      ...fields,
      ...Array.from(customFields).map((field) => ({
        label: `Custom: ${field}`,
        value: (row: ICustomerPopulated) => String(row.customFields[field] || ''),
      })),
    ];

    const parser = new CSVParser({
      fields: allFields,
      delimiter: ',',
      quote: '"',
      transforms: [
        (value: unknown) => {
          if (value === null || value === undefined) return '';
          if (value instanceof Date) return value.toISOString();
          return String(value);
        },
      ],
    });

    return Buffer.from(parser.parse(customers));
  }

  private async generateExcel(customers: ICustomerPopulated[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customers');

    // Define base columns
    const baseColumns = [
      { header: 'Customer ID', key: 'id', width: 24 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Country Code', key: 'countryCode', width: 15 },
      { header: 'Phone Number', key: 'phoneNumber', width: 15 },
      { header: 'Admin Email', key: 'adminEmail', width: 30 },
      { header: 'Admin Name', key: 'adminName', width: 30 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Active', key: 'isActive', width: 10 },
      { header: 'Tags', key: 'tags', width: 20 },
      { header: 'Notes', key: 'notes', width: 30 },
      { header: 'Source', key: 'source', width: 15 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Updated At', key: 'updatedAt', width: 20 },
    ] as const;

    // Add custom field columns
    const customFields = new Set<string>();
    customers.forEach((customer) => {
      if (customer.customFields) {
        Object.keys(customer.customFields).forEach((key) => customFields.add(key));
      }
    });

    const customColumns = Array.from(customFields).map((field) => ({
      header: `Custom: ${field}`,
      key: `custom_${field}`,
      width: 20,
    }));

    worksheet.columns = [...baseColumns, ...customColumns];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    customers.forEach((customer) => {
      const row = {
        id: customer._id.toString(),
        name: customer.name,
        countryCode: customer.phoneNumber.countryCode,
        phoneNumber: customer.phoneNumber.number,
        adminEmail: customer.assignedAdmin.email,
        adminName: `${customer.assignedAdmin.firstName} ${customer.assignedAdmin.lastName}`,
        status: customer.status,
        isActive: customer.isActive ? 'Yes' : 'No',
        tags: customer.tags?.join(', ') || '',
        notes: customer.notes || '',
        source: customer.metadata.source,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
      } as Record<string, string>;

      // Add custom field values
      customFields.forEach((field) => {
        row[`custom_${field}`] = String(customer.customFields[field] || '');
      });

      worksheet.addRow(row);
    });

    // Apply styling to all cells
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        // Align header cells
        if (rowNumber === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }

        // Format dates
        if (
          cell.value &&
          typeof cell.value === 'string' &&
          cell.value.match(/^\d{4}-\d{2}-\d{2}T/)
        ) {
          cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
        }
      });
    });

    // Enable filtering
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length },
    };

    // Freeze header row
    worksheet.views = [
      {
        state: 'frozen',
        xSplit: 0,
        ySplit: 1,
        activeCell: 'A2',
        showGridLines: true,
      },
    ];

    return (await workbook.xlsx.writeBuffer()) as Buffer;
  }

  public async exportCustomers(filters: CustomerFilters, format: 'csv' | 'xlsx'): Promise<Buffer> {
    try {
      const docs = await CustomerModel.find(filters)
        .populate<{ assignedAdmin: PopulatedAdmin }>({
          path: 'assignedAdmin',
          select: 'firstName lastName email',
        })
        .lean()
        .exec();

      // Validate and convert populated documents
      const customers = docs.map((doc) => {
        const populatedDoc = doc as unknown as PopulatedCustomer;

        // Validate populated fields
        if (
          !populatedDoc.assignedAdmin?.firstName ||
          !populatedDoc.assignedAdmin?.lastName ||
          !populatedDoc.assignedAdmin?.email
        ) {
          throw new ApiError(500, `Failed to populate customer data for ID: ${doc._id}`);
        }

        return this.convertToCustomerPopulated(populatedDoc);
      });

      // Process in chunks if the result set is large
      if (customers.length > this.EXPORT_CHUNK_SIZE) {
        logger.info(`Processing large export with ${customers.length} customers`);
      }

      return format === 'csv'
        ? await this.generateCSV(customers)
        : await this.generateExcel(customers);
    } catch (error) {
      logger.error('Error exporting customers:', error);
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, 'Failed to export customers');
    }
  }

  public async updateCustomer(
    customerId: string,
    updateData: Partial<ICustomer>,
    user: ITokenPayload,
  ): Promise<ICustomerPopulated> {
    try {
      const schema = await this.getActiveSchema();

      if (updateData.customFields) {
        for (const [key, value] of Object.entries(updateData.customFields)) {
          const fieldSchema = schema.fields.find((f) => f.name === key);
          if (fieldSchema && !this.validateFieldValue(fieldSchema, value)) {
            throw new ApiError(400, `Invalid value for field: ${key}`);
          }
        }
      }

      const updateWithMetadata = {
        ...updateData,
        'metadata.lastUpdatedBy': new Types.ObjectId(user.userId),
      };

      // Update the population type hint
      const doc = await CustomerModel.findByIdAndUpdate(
        new Types.ObjectId(customerId),
        { $set: updateWithMetadata },
        {
          new: true,
          populate: {
            path: 'assignedAdmin',
            select: 'firstName lastName email',
          },
        },
      )
        .lean()
        .exec();

      if (!doc) {
        throw new ApiError(404, 'Customer not found');
      }

      // Type assertion after verifying the shape
      const populatedDoc = doc as unknown as PopulatedCustomer;
      if (
        !populatedDoc.assignedAdmin?.firstName ||
        !populatedDoc.assignedAdmin?.lastName ||
        !populatedDoc.assignedAdmin?.email
      ) {
        throw new ApiError(500, 'Failed to populate customer data');
      }

      const customer = this.convertToCustomerPopulated(populatedDoc);

      await Promise.all([Redis.del(`customers:${customerId}`), Redis.del('customers:list:*')]);

      await auditService.log({
        userId: user.userId,
        action: 'customer.update',
        category: 'data',
        details: {
          customerId,
          changes: updateData,
        },
        ipAddress: 'system',
        userAgent: 'system',
        status: 'success',
      });

      return customer;
    } catch (error) {
      logger.error('Error updating customer:', error);
      throw error instanceof ApiError ? error : new ApiError(500, 'Failed to update customer');
    }
  }

  public async deleteCustomer(customerId: string, user: ITokenPayload): Promise<void> {
    try {
      const result = await CustomerModel.deleteOne({ _id: new Types.ObjectId(customerId) });

      if (result.deletedCount === 0) {
        throw new ApiError(404, 'Customer not found');
      }

      await Promise.all([Redis.del(`customers:${customerId}`), Redis.del('customers:list:*')]);

      await auditService.log({
        userId: user.userId,
        action: 'customer.delete',
        category: 'data',
        details: {
          customerId,
        },
        ipAddress: 'system',
        userAgent: 'system',
        status: 'success',
      });
    } catch (error) {
      logger.error('Error deleting customer:', error);
      throw error instanceof ApiError ? error : new ApiError(500, 'Failed to delete customer');
    }
  }

  public async bulkUpdateCustomers(
    ids: string[],
    updates: Partial<ICustomer>,
    user: ITokenPayload,
  ): Promise<number> {
    try {
      if (ids.length > this.MAX_BATCH_SIZE) {
        throw new ApiError(400, `Cannot update more than ${this.MAX_BATCH_SIZE} customers at once`);
      }

      const objectIds = ids.map((id) => new Types.ObjectId(id));

      const updateWithMetadata = {
        ...updates,
        'metadata.lastUpdatedBy': new Types.ObjectId(user.userId),
      };

      const result = await CustomerModel.updateMany(
        { _id: { $in: objectIds } },
        { $set: updateWithMetadata },
      );

      // Clear cache for all affected customers
      await Promise.all([
        ...ids.map((id) => Redis.del(`customers:${id}`)),
        Redis.del('customers:list:*'),
      ]);

      await auditService.log({
        userId: user.userId,
        action: 'customer.bulk_update',
        category: 'data',
        details: {
          customerIds: ids,
          changes: updates,
          affectedCount: result.modifiedCount,
        },
        ipAddress: 'system',
        userAgent: 'system',
        status: 'success',
      });

      return result.modifiedCount;
    } catch (error) {
      logger.error('Error in bulk update customers:', error);
      throw error instanceof ApiError
        ? error
        : new ApiError(500, 'Failed to bulk update customers');
    }
  }

  public async updateSchema(fields: ICustomField[], user: ITokenPayload): Promise<ICustomerSchema> {
    try {
      const existingSchema = await CustomerSchemaModel.findOne({ isActive: true })
        .sort({ version: -1 })
        .lean();

      const newVersion = existingSchema ? existingSchema.version + 1 : 1;

      const newSchema = await CustomerSchemaModel.create({
        fields,
        version: newVersion,
        isActive: true,
        metadata: {
          lastUpdatedBy: new Types.ObjectId(user.userId),
          changes: [
            {
              date: new Date(),
              updatedBy: new Types.ObjectId(user.userId),
              change: {
                type: 'modify',
                field: 'schema',
                details: { version: newVersion },
              },
            },
          ],
        },
      });

      // Deactivate old schema
      if (existingSchema) {
        await CustomerSchemaModel.updateOne(
          { _id: existingSchema._id },
          { $set: { isActive: false } },
        );
      }

      // Update cache
      const schemaDoc = newSchema.toObject();
      await this.setCachedSchema(schemaDoc);

      await auditService.log({
        userId: user.userId,
        action: 'schema.update',
        category: 'data',
        details: {
          version: newVersion,
          fields,
        },
        ipAddress: 'system',
        userAgent: 'system',
        status: 'success',
      });

      return schemaDoc;
    } catch (error) {
      logger.error('Error updating schema:', error);
      throw new ApiError(500, 'Failed to update schema');
    }
  }
}

export const customerService = CustomerService.getInstance();
