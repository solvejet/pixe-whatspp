// src/models/customer.model.ts
import { Schema, model } from 'mongoose';
import type { ICustomer, ICustomerSchema, FieldType, ISchemaChange } from '@/types/customer.js';

const phoneNumberSchema = new Schema({
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    trim: true,
  },
  number: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },
});

const metadataSchema = new Schema({
  lastUpdatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  source: {
    type: String,
    required: true,
    trim: true,
  },
  importId: {
    type: String,
    trim: true,
  },
});

// Customer Schema
const customerSchema = new Schema<ICustomer>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
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
      required: [true, 'Assigned admin is required'],
      index: true,
    },
    customFields: {
      type: Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive', 'pending', 'archived', 'blocked'],
        message: '{VALUE} is not a valid status',
      },
      default: 'active',
      required: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    metadata: {
      type: metadataSchema,
      required: true,
    },
  },
  {
    timestamps: true,
    // Enable optimistic concurrency
    optimisticConcurrency: true,
    // Add strict validation for schema
    strict: true,
    // Enable virtuals in JSON
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

const schemaChangeSchema = new Schema<ISchemaChange>({
  date: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  change: {
    type: {
      type: String,
      enum: ['add', 'remove', 'modify'],
      required: true,
    },
    field: {
      type: String,
      required: true,
    },
    details: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
});

// Custom Field Schema
const customFieldSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Field name is required'],
    trim: true,
  },
  type: {
    type: String,
    enum: {
      values: ['string', 'number', 'select', 'date', 'boolean'],
      message: '{VALUE} is not a valid field type',
    },
    required: true,
  },
  required: {
    type: Boolean,
    default: false,
  },
  options: {
    type: [String],
    validate: {
      validator: function (v: string[] | undefined) {
        const field = this as { type: FieldType };
        return field.type !== 'select' || (Array.isArray(v) && v.length > 0);
      },
      message: 'Select fields must have at least one option',
    },
  },
  description: String,
  isDefault: {
    type: Boolean,
    default: false,
  },
  validation: {
    min: Number,
    max: Number,
    pattern: String,
    message: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Customer Schema Version Schema
const customerSchemaVersionSchema = new Schema<ICustomerSchema>(
  {
    fields: [customFieldSchema],
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    metadata: {
      lastUpdatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      changes: [schemaChangeSchema],
    },
  },
  {
    timestamps: true,
    // Add optimistic concurrency
    optimisticConcurrency: true,
  },
);

// Indexes
customerSchema.index({ 'customFields.name': 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ name: 'text', tags: 'text' });
customerSchema.index({ status: 1, createdAt: -1 });
customerSchema.index({ assignedAdmin: 1, status: 1 });

customerSchemaVersionSchema.index({ version: -1 });
customerSchemaVersionSchema.index({ isActive: 1, version: -1 });

// Create models
export const CustomerModel = model<ICustomer>('Customer', customerSchema);
export const CustomerSchemaModel = model<ICustomerSchema>(
  'CustomerSchema',
  customerSchemaVersionSchema,
);
