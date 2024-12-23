// src/models/customer.model.ts
import { Schema, model, Types } from 'mongoose';
import type { Model, Query } from 'mongoose';
import type {
  ICustomerDocument,
  ICustomerGroupDocument,
  CustomField,
  DynamicFields,
  PopulatedGroup,
} from '@/types/customer.js';
import { CustomerStatus, CustomFieldType } from '@/types/customer.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';

interface CustomerStatistics {
  statusDistribution: Array<{ _id: string; count: number }>;
  groupDistribution: Array<{
    _id: Types.ObjectId;
    name: string;
    count: number;
  }>;
  timeline: Array<{
    _id: {
      year: number;
      month: number;
      day: number;
    };
    count: number;
  }>;
  total: number;
}

interface DeleteManyQuery extends Query<unknown, ICustomerDocument> {
  getFilter(): Record<string, unknown>;
}

// Type definitions
interface CustomerModelStatics extends Model<ICustomerDocument> {
  getByGroup(
    groupId: Types.ObjectId,
    page?: number,
    limit?: number,
  ): Promise<Array<ICustomerDocument>>;

  findByStatus(
    status: CustomerStatus,
    page?: number,
    limit?: number,
  ): Promise<Array<ICustomerDocument>>;

  search(criteria: {
    query?: string;
    status?: CustomerStatus;
    groupId?: Types.ObjectId;
    assignedAdmin?: Types.ObjectId;
    tags?: string[];
    fromDate?: Date;
    toDate?: Date;
  }): Promise<Array<ICustomerDocument>>;

  batchUpdate(
    updates: Array<{
      id: Types.ObjectId;
      data: Partial<ICustomerDocument>;
    }>,
  ): Promise<{
    ok: number;
    modifiedCount: number;
    matchedCount: number;
    upsertedCount: number;
    upsertedIds: { [key: number]: Types.ObjectId };
    insertedCount: number;
    insertedIds: { [key: number]: Types.ObjectId };
    hasWriteErrors: boolean;
  }>;

  getStatistics(dateRange?: { start: Date; end: Date }): Promise<CustomerStatistics>;

  generateReport(options: {
    groupBy?: 'status' | 'group' | 'admin';
    dateRange?: { start: Date; end: Date };
    includeInactive?: boolean;
  }): Promise<CustomerReport[]>;
}

interface CustomerReport {
  _id: string | Types.ObjectId | null;
  total: number;
}

interface DateRangeQuery {
  $gte?: Date;
  $lte?: Date;
}

interface AggregateMatchStage {
  createdAt?: {
    $gte: Date;
    $lte: Date;
  };
  status?: CustomerStatus;
}

/**
 * Cache configuration for custom fields validation
 */
const CACHE_CONFIG = {
  TTL: 5 * 60 * 1000, // 5 minutes
  MAX_SIZE: 1000, // Maximum cache entries
} as const;

/**
 * LRU Cache for group custom fields
 */
class CustomFieldsCache {
  private cache = new Map<string, { fields: CustomField[]; timestamp: number }>();

  public set(key: string, fields: CustomField[]): void {
    if (this.cache.size >= CACHE_CONFIG.MAX_SIZE) {
      const firstKey = [...this.cache.keys()][0];
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { fields, timestamp: Date.now() });
  }

  public get(key: string): CustomField[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_CONFIG.TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.fields;
  }

  public clear(): void {
    this.cache.clear();
  }
}

const groupFieldsCache = new CustomFieldsCache();

/**
 * Type guard for populated groups
 */
function isPopulatedGroup(group: Types.ObjectId | PopulatedGroup): group is PopulatedGroup {
  return (group as PopulatedGroup).name !== undefined;
}

/**
 * Custom field schema definition
 */
const customFieldSchema = new Schema<CustomField>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: Object.values(CustomFieldType),
      required: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    listOptions: [String],
    defaultValue: Schema.Types.Mixed,
    description: String,
    validation: {
      min: Number,
      max: Number,
      pattern: String,
      message: String,
    },
  },
  { _id: false },
);

/**
 * Customer schema definition
 */
const customerSchema = new Schema<ICustomerDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: 'text',
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    countryCode: {
      type: String,
      required: true,
      trim: true,
    },
    assignedAdmin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CustomerStatus),
      default: CustomerStatus.ACTIVE,
      index: true,
    },
    customFields: {
      type: Map,
      of: Schema.Types.Mixed,
      default: (): Map<string, unknown> => new Map(),
    },
    groups: [
      {
        type: Schema.Types.ObjectId,
        ref: 'CustomerGroup',
        index: true,
      },
    ],
    tags: {
      type: [String],
      default: [],
    },
    lastActivity: {
      type: Date,
      default: null,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: (): Record<string, unknown> => ({}),
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

/**
 * Customer group schema definition
 */
const customerGroupSchema = new Schema<ICustomerGroupDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    customFields: [customFieldSchema],
    customers: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Customer',
      },
    ],
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: (): Record<string, unknown> => ({}),
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

/**
 * Validate field value based on type
 */
function validateFieldValue(value: unknown, field: CustomField): void {
  switch (field.type) {
    case CustomFieldType.NUMBER:
      if (typeof value !== 'number') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${field.name} must be a number`,
          400,
          true,
          { details: { fieldName: field.name, type: 'number' } },
        );
      }
      if (field.validation) {
        const { min, max } = field.validation;
        if (min !== undefined && value < min) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `${field.name} must be greater than or equal to ${min}`,
            400,
            true,
            { details: { fieldName: field.name, min } },
          );
        }
        if (max !== undefined && value > max) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `${field.name} must be less than or equal to ${max}`,
            400,
            true,
            { details: { fieldName: field.name, max } },
          );
        }
      }
      break;

    case CustomFieldType.DATE:
      if (!(value instanceof Date) && isNaN(Date.parse(value as string))) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${field.name} must be a valid date`,
          400,
          true,
          { details: { fieldName: field.name, type: 'date' } },
        );
      }
      break;

    case CustomFieldType.BOOLEAN:
      if (typeof value !== 'boolean') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${field.name} must be a boolean`,
          400,
          true,
          { details: { fieldName: field.name, type: 'boolean' } },
        );
      }
      break;

    case CustomFieldType.LIST:
      if (!field.listOptions?.includes(value as string)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid value for ${field.name}. Must be one of: ${field.listOptions?.join(', ')}`,
          400,
          true,
          { details: { fieldName: field.name, validOptions: field.listOptions } },
        );
      }
      break;

    case CustomFieldType.TEXT:
      if (typeof value !== 'string') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${field.name} must be a string`,
          400,
          true,
          { details: { fieldName: field.name, type: 'string' } },
        );
      }
      if (field.validation?.pattern) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(value)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            field.validation.message || `${field.name} does not match required pattern`,
            400,
            true,
            { details: { fieldName: field.name, pattern: field.validation.pattern } },
          );
        }
      }
      break;
  }
}

/**
 * Validate custom fields based on group definitions
 */
async function validateCustomFields(
  customFields: DynamicFields,
  groups: Array<Types.ObjectId | PopulatedGroup>,
): Promise<void> {
  try {
    const groupIds = groups.map((group) => (isPopulatedGroup(group) ? group._id : group));

    // Get group fields from cache or database
    const cacheKey = groupIds
      .map((id) => id.toString())
      .sort()
      .join(',');
    let groupFields = groupFieldsCache.get(cacheKey);

    if (!groupFields) {
      const CustomerGroup = model<ICustomerGroupDocument>('CustomerGroup');
      const fetchedGroups = await CustomerGroup.find(
        { _id: { $in: groupIds } },
        { customFields: 1 },
      ).lean();

      groupFields = fetchedGroups.flatMap((group) => group.customFields);
      groupFieldsCache.set(cacheKey, groupFields);
    }

    // Create field definitions map
    const fieldDefs = new Map(groupFields.map((field) => [field.name, field]));

    // Validate each custom field
    for (const [fieldName, value] of customFields.entries()) {
      const fieldDef = fieldDefs.get(fieldName);

      if (!fieldDef) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unknown custom field: ${fieldName}`,
          400,
          true,
          { details: { fieldName } },
        );
      }

      if (fieldDef.required && value == null) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Field ${fieldName} is required`,
          400,
          true,
          { details: { fieldName } },
        );
      }

      if (value != null) {
        validateFieldValue(value, fieldDef);
      }
    }

    // Check for missing required fields
    for (const field of groupFields) {
      if (field.required && !customFields.has(field.name)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Required field ${field.name} is missing`,
          400,
          true,
          { details: { fieldName: field.name } },
        );
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Custom fields validation failed', 400, true, {
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

// Indexes
customerSchema.index({ phoneNumber: 1, countryCode: 1 }, { unique: true });
customerSchema.index({ status: 1, createdAt: -1 });
customerSchema.index({ assignedAdmin: 1, status: 1 });
customerSchema.index({ groups: 1, status: 1 });
customerSchema.index({ 'customFields.name': 1 });
customerSchema.index({ createdAt: -1 });

/**
 * Static methods
 */
customerSchema.statics = {
  async getByGroup(
    groupId: Types.ObjectId,
    page = 1,
    limit = 10,
  ): Promise<Array<ICustomerDocument>> {
    return this.find({ groups: groupId })
      .populate('assignedAdmin', 'email firstName lastName')
      .populate('groups', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
  },

  async findByStatus(
    status: CustomerStatus,
    page = 1,
    limit = 10,
  ): Promise<Array<ICustomerDocument>> {
    return this.find({ status })
      .populate('assignedAdmin', 'email firstName lastName')
      .populate('groups', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
  },

  async search(criteria: {
    query?: string;
    status?: CustomerStatus;
    groupId?: Types.ObjectId;
    assignedAdmin?: Types.ObjectId;
    tags?: string[];
    fromDate?: Date;
    toDate?: Date;
  }): Promise<Array<ICustomerDocument>> {
    const query: Record<string, unknown> = {};

    if (criteria.query) {
      query.$or = [
        { name: new RegExp(criteria.query, 'i') },
        { phoneNumber: new RegExp(criteria.query, 'i') },
        { tags: new RegExp(criteria.query, 'i') },
      ];
    }

    if (criteria.status) query.status = criteria.status;
    if (criteria.groupId) query.groups = criteria.groupId;
    if (criteria.assignedAdmin) query.assignedAdmin = criteria.assignedAdmin;
    if (criteria.tags?.length) query.tags = { $in: criteria.tags };

    if (criteria.fromDate || criteria.toDate) {
      const createdAt: DateRangeQuery = {};
      if (criteria.fromDate) createdAt.$gte = criteria.fromDate;
      if (criteria.toDate) createdAt.$lte = criteria.toDate;
      query.createdAt = createdAt;
    }

    return this.find(query)
      .populate('assignedAdmin', 'email firstName lastName')
      .populate('groups', 'name')
      .sort({ createdAt: -1 });
  },

  async batchUpdate(
    updates: Array<{
      id: Types.ObjectId;
      data: Partial<ICustomerDocument>;
    }>,
  ): Promise<{
    ok: number;
    modifiedCount: number;
    matchedCount: number;
    upsertedCount: number;
    upsertedIds: { [key: number]: Types.ObjectId };
    insertedCount: number;
    insertedIds: { [key: number]: Types.ObjectId };
    hasWriteErrors: boolean;
  }> {
    const bulkOps = updates.map(({ id, data }) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: data },
        runValidators: true,
      },
    }));

    try {
      const result = await this.bulkWrite(bulkOps);

      // Return standardized result with correct properties
      return {
        ok: 1, // MongoDB success indicator
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        upsertedCount: result.upsertedCount,
        upsertedIds: result.upsertedIds,
        insertedCount: result.insertedCount,
        insertedIds: result.insertedIds,
        hasWriteErrors: result.hasWriteErrors(),
      };
    } catch (error) {
      throw new AppError(ErrorCode.DATABASE_ERROR, 'Batch update failed', 500, true, {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          updates: updates.map((u) => u.id.toString()),
        },
      });
    }
  },

  async getStatistics(dateRange?: { start: Date; end: Date }): Promise<CustomerStatistics> {
    const matchStage: AggregateMatchStage = {};
    if (dateRange) {
      matchStage.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end,
      };
    }

    const [statusStats, groupStats, timeline] = await Promise.all([
      // Status distribution
      this.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),

      // Group distribution
      this.aggregate([
        { $match: matchStage },
        { $unwind: '$groups' },
        {
          $group: {
            _id: '$groups',
            count: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: 'customergroups',
            localField: '_id',
            foreignField: '_id',
            as: 'groupInfo',
          },
        },
        { $unwind: '$groupInfo' },
        {
          $project: {
            name: '$groupInfo.name',
            count: 1,
          },
        },
      ]),

      // Timeline
      this.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),
    ]);

    return {
      statusDistribution: statusStats,
      groupDistribution: groupStats,
      timeline,
      total: await this.countDocuments(matchStage),
    };
  },

  async generateReport(options: {
    groupBy?: 'status' | 'group' | 'admin';
    dateRange?: { start: Date; end: Date };
    includeInactive?: boolean;
  }): Promise<CustomerReport[]> {
    const matchStage: AggregateMatchStage = {};

    if (options.dateRange) {
      matchStage.createdAt = {
        $gte: options.dateRange.start,
        $lte: options.dateRange.end,
      };
    }

    if (!options.includeInactive) {
      matchStage.status = CustomerStatus.ACTIVE;
    }

    // Define proper group stage type
    const groupStage: {
      $group: {
        _id: string | null;
        total: { $sum: number };
      };
    } = {
      $group: {
        _id: null,
        total: { $sum: 1 },
      },
    };

    // Set _id based on groupBy option
    switch (options.groupBy) {
      case 'status':
        groupStage.$group._id = '$status';
        break;
      case 'group':
        groupStage.$group._id = '$groups';
        break;
      case 'admin':
        groupStage.$group._id = '$assignedAdmin';
        break;
    }

    return this.aggregate([{ $match: matchStage }, groupStage, { $sort: { total: -1 } }]);
  },
};

/**
 * Instance methods
 */
customerSchema.methods = {
  async updateLastActivity(): Promise<ICustomerDocument> {
    this.lastActivity = new Date();
    return this.save();
  },

  async addTags(tags: string[]): Promise<ICustomerDocument> {
    const uniqueTags = [...new Set([...this.tags, ...tags])];
    this.tags = uniqueTags;
    return this.save();
  },

  async removeTags(tags: string[]): Promise<ICustomerDocument> {
    this.tags = this.tags.filter((currentTag: string) => !tags.includes(currentTag));
    return this.save();
  },

  async manageGroups(
    groupIds: Types.ObjectId[],
    operation: 'add' | 'remove' | 'set',
  ): Promise<ICustomerDocument> {
    switch (operation) {
      case 'add':
        this.groups = [...new Set([...this.groups, ...groupIds])];
        break;
      case 'remove':
        this.groups = this.groups.filter(
          (existingGroupId: Types.ObjectId) => !groupIds.some((id) => id.equals(existingGroupId)),
        );
        break;
      case 'set':
        this.groups = groupIds;
        break;
    }
    return this.save();
  },
};

/**
 * Middleware
 */
customerSchema.pre('save', async function (next): Promise<void> {
  if (this.isModified('customFields')) {
    try {
      await validateCustomFields(this.customFields, this.groups);
      next();
    } catch (error: unknown) {
      next(error instanceof Error ? error : new Error('Unknown error in save middleware'));
    }
  } else {
    next();
  }
});

customerSchema.pre(
  'deleteOne',
  { document: true, query: false },
  async function (next): Promise<void> {
    try {
      const CustomerGroup = model<ICustomerGroupDocument>('CustomerGroup');
      await CustomerGroup.updateMany({ customers: this._id }, { $pull: { customers: this._id } });
      next();
    } catch (error: unknown) {
      logger.error('Error in customer deleteOne middleware:', error);
      next(new Error(error instanceof Error ? error.message : 'Unknown error in deleteOne'));
    }
  },
);

customerSchema.pre(
  'deleteMany',
  async function (this: DeleteManyQuery, next: (err?: Error) => void): Promise<void> {
    try {
      const CustomerGroup = model<ICustomerGroupDocument>('CustomerGroup');

      const docs = await CustomerModel.find(this.getFilter(), { _id: 1 }).lean<
        Array<{ _id: Types.ObjectId }>
      >();

      if (!Array.isArray(docs)) {
        const error = new AppError(
          ErrorCode.DATABASE_ERROR,
          'Invalid response from database query',
          500,
          true,
          {
            details: { source: 'deleteMany middleware' },
          },
        );
        return next(error);
      }

      const customerIds = docs.map((doc) => doc._id);

      if (customerIds.length > 0) {
        await CustomerGroup.updateMany(
          { customers: { $in: customerIds } },
          { $pullAll: { customers: customerIds } },
        );
      }

      next();
    } catch (error) {
      logger.error('Error in customer deleteMany middleware:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error in deleteMany';

      // Create the error and pass it to next()
      const appError = new AppError(ErrorCode.DATABASE_ERROR, errorMessage, 500, true, {
        details: {
          source: 'deleteMany middleware',
          error: errorMessage,
        },
      });

      return next(appError);
    }
  },
);

// And for the post save middleware:
customerSchema.post('save', async function (doc: ICustomerDocument): Promise<void> {
  try {
    const CustomerGroup = model<ICustomerGroupDocument>('CustomerGroup');
    const groupIds = doc.groups.map(
      (group): Types.ObjectId => (isPopulatedGroup(group) ? group._id : group),
    );

    await Promise.all([
      CustomerGroup.updateMany(
        {
          _id: { $nin: groupIds },
          customers: doc._id,
        },
        { $pull: { customers: doc._id } },
      ),
      CustomerGroup.updateMany({ _id: { $in: groupIds } }, { $addToSet: { customers: doc._id } }),
    ]);
  } catch (error: unknown) {
    logger.error(
      'Error updating customer groups:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
});

/**
 * Export models with proper typing
 */
export const CustomerModel = model<ICustomerDocument, CustomerModelStatics>(
  'Customer',
  customerSchema,
);
export const CustomerGroupModel = model<ICustomerGroupDocument>(
  'CustomerGroup',
  customerGroupSchema,
);
