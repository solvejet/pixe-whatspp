// src/types/customer.ts
import type { Document, Types } from 'mongoose';

// Field Types
export type FieldType = 'string' | 'number' | 'select' | 'date' | 'boolean';
export type CustomerStatus = 'active' | 'inactive' | 'pending' | 'archived' | 'blocked';

export type LeanDocument<T> = {
  [P in keyof T]: T[P] extends Document ? LeanDocument<T[P]> : T[P];
} & { _id: Types.ObjectId };

// Custom Field Definition
export interface ICustomField {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  description?: string;
  isDefault?: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Phone Number Interface
export interface IPhoneNumber {
  countryCode: string;
  number: string;
}

// User Reference Interface
export interface IUserRef {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
}

// Schema Change History
export interface ISchemaChange {
  date: Date;
  updatedBy: Types.ObjectId;
  change: {
    type: 'add' | 'remove' | 'modify';
    field: string;
    details: Record<string, unknown>;
  };
}

// Base Customer Interface
export interface ICustomerBase {
  _id: Types.ObjectId;
  name: string;
  phoneNumber: {
    countryCode: string;
    number: string;
  };
  assignedAdmin: Types.ObjectId;
  customFields: Record<string, unknown>;
  isActive: boolean;
  status: CustomerStatus;
  tags?: string[];
  notes?: string;
  metadata: {
    lastUpdatedBy: Types.ObjectId;
    source: string;
    importId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Customer Document Interface with populated fields
export interface ICustomerPopulated extends Omit<ICustomerBase, 'assignedAdmin'> {
  _id: Types.ObjectId;
  assignedAdmin: IUserRef;
}

// Customer Document Interface
export interface ICustomer extends Omit<ICustomerBase, '_id'>, Document {
  assignedAdmin: Types.ObjectId;
}
// Customer Schema Fields Interface
export interface ICustomerSchema {
  _id: Types.ObjectId;
  fields: ICustomField[];
  version: number;
  isActive: boolean;
  metadata: {
    lastUpdatedBy: Types.ObjectId;
    changes: ISchemaChange[];
  };
  createdAt: Date;
  updatedAt: Date;
}


// Query and Filter Interfaces
export interface CustomerFilters {
  name?: { $regex: string; $options: string };
  assignedAdmin?: Types.ObjectId;
  status?: CustomerStatus;
  tags?: { $in: string[] };
  isActive?: boolean;
  createdAt?: {
    $gte?: Date;
    $lte?: Date;
  };
  customFields?: Record<string, unknown>;
}

export interface CustomerSortOptions {
  field: string;
  order: 'asc' | 'desc';
}

// Service Response Types
export interface CustomerListResponse {
  customers: ICustomerPopulated[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
