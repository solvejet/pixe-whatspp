// src/types/custom-fields.ts
import type { CustomFieldType } from './customer.js';

export interface CreateCustomFieldRequest {
  name: string;
  type: CustomFieldType;
  required?: boolean;
  listOptions?: string[]; // Required for LIST type fields
  defaultValue?: unknown;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface UpdateCustomFieldRequest extends Partial<CreateCustomFieldRequest> {
  name?: string;
}

export interface CustomFieldResponse {
  id: string;
  name: string;
  type: CustomFieldType;
  required: boolean;
  listOptions: string[];
  defaultValue?: unknown;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BatchUpdateCustomFieldsRequest {
  fields: Array<{
    id: string;
    updates: UpdateCustomFieldRequest;
  }>;
}

export interface CustomFieldsService {
  createCustomField(data: CreateCustomFieldRequest, userId: string): Promise<CustomFieldResponse>;
  updateCustomField(
    fieldId: string,
    data: UpdateCustomFieldRequest,
    userId: string,
  ): Promise<CustomFieldResponse>;
  deleteCustomField(fieldId: string, userId: string): Promise<void>;
  getCustomField(fieldId: string): Promise<CustomFieldResponse>;
  listCustomFields(
    page?: number,
    limit?: number,
  ): Promise<{
    fields: CustomFieldResponse[];
    total: number;
    pages: number;
  }>;
  batchUpdateCustomFields(
    updates: BatchUpdateCustomFieldsRequest,
    userId: string,
  ): Promise<CustomFieldResponse[]>;
}
