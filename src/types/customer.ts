import type { Document, Types } from 'mongoose';
import type { WithTimestamps } from './mongoose.js';

/**
 * Customer Status Enum
 */
export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  BLOCKED = 'blocked',
}

/**
 * Custom Field Types Enum
 */
export enum CustomFieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  BOOLEAN = 'boolean',
  LIST = 'list',
}

/**
 * Custom Field Validation Interface
 */
export interface CustomFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

/**
 * Custom Field Definition
 */
export interface CustomField extends CustomFieldBase {
  _id: Types.ObjectId;
}

/**
 * Dynamic Fields Map Type
 */
export type DynamicFields = Map<string, unknown>;

/**
 * Base Customer Interface
 */
export interface ICustomer extends WithTimestamps {
  name: string;
  phoneNumber: string;
  countryCode: string;
  assignedAdmin: Types.ObjectId;
  status: CustomerStatus;
  customFields: DynamicFields;
  groups: Array<Types.ObjectId | PopulatedGroup>;
  tags: string[];
  lastActivity: Date | null;
  metadata: Map<string, unknown>;
}

/**
 * Customer Document Interface for Mongoose
 */
export interface ICustomerDocument extends ICustomer, Document {
  updateLastActivity(): Promise<ICustomerDocument>;
  addTags(tags: string[]): Promise<ICustomerDocument>;
  removeTags(tags: string[]): Promise<ICustomerDocument>;
  manageGroups(
    groupIds: Types.ObjectId[],
    operation: 'add' | 'remove' | 'set',
  ): Promise<ICustomerDocument>;
}

/**
 * Base Customer Group Interface
 */
export interface ICustomerGroup extends WithTimestamps {
  name: string;
  description?: string;
  customFields: CustomField[];
  customers: Types.ObjectId[];
  metadata: Map<string, unknown>;
}

export interface AdminDocument {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
}

export interface GroupDocument {
  _id: Types.ObjectId;
  name: string;
  description?: string;
}

export interface PopulatedCustomerDocument
  extends Omit<ICustomerDocument, 'assignedAdmin' | 'groups'> {
  _id: Types.ObjectId;
  assignedAdmin: AdminDocument;
  groups: GroupDocument[];
  customFields: Map<string, unknown>;
  metadata: Map<string, unknown>;
}

/**
 * Customer Group Document Interface for Mongoose
 */
export interface ICustomerGroupDocument extends ICustomerGroup, Document {}

/**
 * Populated Group Type for Type Safety
 */
export interface PopulatedGroup {
  _id: Types.ObjectId;
  name: string;
  description?: string;
}

/**
 * Customer Response DTOs
 */
export interface CustomerResponse {
  id: string;
  name: string;
  phoneNumber: string;
  countryCode: string;
  assignedAdmin: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  status: CustomerStatus; // Using the enum here
  customFields: Record<string, unknown>;
  groups: Array<{
    id: string;
    name: string;
  }>;
  tags: string[];
  lastActivity: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldBase {
  name: string;
  type: CustomFieldType;
  required?: boolean;
  listOptions?: string[];
  defaultValue?: unknown;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface CustomerGroupResponse {
  id: string;
  name: string;
  description?: string;
  customFields: CustomField[];
  customersCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request DTOs
 */
export interface CreateCustomerRequest {
  name: string;
  phoneNumber: string;
  countryCode: string;
  assignedAdmin: string;
  status?: CustomerStatus;
  customFields?: Record<string, unknown>;
  groups?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCustomerRequest {
  name?: string;
  phoneNumber?: string;
  countryCode?: string;
  assignedAdmin?: string;
  status?: CustomerStatus;
  customFields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateCustomerGroupRequest {
  name: string;
  description?: string;
  customFields?: CustomField[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCustomerGroupRequest {
  name?: string;
  description?: string;
  customFields?: CustomField[];
  metadata?: Record<string, unknown>;
}

/**
 * Search/Filter Types
 */
export interface CustomerSearchCriteria {
  query?: string;
  status?: CustomerStatus;
  groupId?: string;
  assignedAdmin?: string;
  tags?: string[];
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

/**
 * Batch Operation Types
 */
export interface BatchUpdateOperation {
  id: string;
  data: Partial<UpdateCustomerRequest>;
}

export interface BatchOperationResult {
  ok: number;
  modifiedCount: number;
  matchedCount: number;
  upsertedCount: number;
  upsertedIds: { [key: number]: Types.ObjectId };
  insertedCount: number;
  insertedIds: { [key: number]: Types.ObjectId };
  hasWriteErrors: boolean;
}

/**
 * Statistics & Reporting Types
 */
export interface CustomerStatistics {
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

export interface CustomerReport {
  _id: string | Types.ObjectId | null;
  total: number;
}
