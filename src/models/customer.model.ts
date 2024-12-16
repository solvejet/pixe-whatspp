// src/models/customer.models.ts

import { Schema, model } from 'mongoose';
import type { ICustomer, ICustomerSchema } from '@/types/customer.js';

const phoneNumberSchema = new Schema({
  countryCode: {
    type: String,
    required: true,
    trim: true,
  },
  number: {
    type: String,
    required: true,
    trim: true,
  },
});

// Dynamic schema for customers
const customerSchema = new Schema<ICustomer>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    phoneNumber: {
      type: phoneNumberSchema,
      required: true,
    },
    assignedAdmin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customFields: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    strict: false, // Allow dynamic fields
  },
);

// Schema definition for customer schema versions
const customerSchemaVersionSchema = new Schema<ICustomerSchema>(
  {
    fields: [
      {
        name: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ['string', 'number', 'select', 'date', 'boolean'],
          required: true,
        },
        required: {
          type: Boolean,
          default: false,
        },
        options: [String], // For select type fields
        description: String,
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Create indexes for better query performance
customerSchema.index({ 'customFields.name': 1 });
customerSchema.index({ createdAt: -1 });

customerSchemaVersionSchema.index({ version: -1 });
customerSchemaVersionSchema.index({ isActive: 1 });

export const CustomerModel = model<ICustomer>('Customer', customerSchema);
export const CustomerSchemaModel = model<ICustomerSchema>(
  'CustomerSchema',
  customerSchemaVersionSchema,
);
