// src/types/customer-requests.ts
import type { ParsedQs } from 'qs';
import type { Types } from 'mongoose';
import type { BaseRequestBody } from './auth.js';
import type { CustomerStatus, FieldType } from './customer.js';

// Schema Update Types
export interface SchemaFieldInput {
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
}

export interface SchemaUpdateBody extends BaseRequestBody {
  fields: SchemaFieldInput[];
}

// Customer Create/Update Types
export interface CustomerCreateBody extends BaseRequestBody {
  name: string;
  phoneNumber: {
    countryCode: string;
    number: string;
  };
  assignedAdmin: string;
  customFields?: Record<string, unknown>;
  status?: CustomerStatus;
  tags?: string[];
  notes?: string;
}

export interface CustomerUpdateBody extends Partial<CustomerCreateBody> {
  isActive?: boolean;
}

// Query Parameters
export interface CustomerQueryParams extends ParsedQs {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  assignedAdmin?: string;
  fromDate?: string;
  toDate?: string;
  status?: CustomerStatus;
  tags?: string[];
  format?: 'csv' | 'xlsx';
}
// Filter Types
export interface CustomerFilters {
  name?: { $regex: string; $options: string };
  assignedAdmin?: Types.ObjectId;
  status?: CustomerStatus;
  tags?: { $in: string[] };
  createdAt?: {
    $gte?: Date;
    $lte?: Date;
  };
  customFields?: Record<string, unknown>;
  isActive?: boolean;
}

// Update Types
export interface CustomerUpdateData {
  name?: string;
  phoneNumber?: {
    countryCode: string;
    number: string;
  };
  assignedAdmin?: Types.ObjectId;
  customFields?: Record<string, unknown>;
  isActive?: boolean;
  status?: CustomerStatus;
  tags?: string[];
  notes?: string;
  metadata?: {
    lastUpdatedBy: Types.ObjectId;
    source?: string;
  };
}

export interface CustomerBulkUpdateBody extends BaseRequestBody {
  ids: string[];
  updates: CustomerUpdateBody;
}

export interface CustomerExportOptions {
  format: 'csv' | 'xlsx';
  filters: CustomerFilters;
  fields?: string[];
}
