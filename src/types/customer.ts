// src/types/customer.ts

import type { Document, Types } from 'mongoose';

export type FieldType = 'string' | 'number' | 'select' | 'date' | 'boolean';

export interface ICustomField {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[]; // For select type fields
  description?: string;
  isDefault?: boolean; // To identify system default fields
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomer extends Document {
  name: string;
  phoneNumber: {
    countryCode: string;
    number: string;
  };
  assignedAdmin: Types.ObjectId;
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerSchema extends Document {
  fields: ICustomField[];
  version: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
