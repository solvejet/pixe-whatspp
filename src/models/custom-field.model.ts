// src/models/custom-field.model.ts

import { Schema, model, type Document, type Types } from 'mongoose';
import type { CustomFieldType, CustomFieldValidation } from '@/types/customer.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';

/**
 * Interface defining base custom field properties without document methods
 */
export interface ICustomFieldBase {
  name: string;
  type: CustomFieldType;
  required?: boolean;
  listOptions?: string[];
  defaultValue?: unknown;
  description?: string;
  validation?: CustomFieldValidation;
}

/**
 * Interface extending base properties with Mongoose Document features
 * Separating the base interface from Document to avoid type conflicts
 */
export interface ICustomFieldDocument extends ICustomFieldBase, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  validateValue(value: unknown): void;
}

/**
 * Schema for validation rules with proper typing
 */
const validationSchema = new Schema<CustomFieldValidation>(
  {
    min: { type: Number },
    max: { type: Number },
    pattern: { type: String },
    message: { type: String },
  },
  { _id: false },
);

/**
 * Custom field schema with enhanced validation and security
 */
const customFieldSchema = new Schema<ICustomFieldDocument>(
  {
    name: {
      type: String,
      required: [true, 'Field name is required'],
      unique: true,
      trim: true,
      index: true,
      validate: {
        validator: (value: string): boolean => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value),
        message:
          'Field name must start with a letter and contain only letters, numbers, and underscores',
      },
    },
    type: {
      type: String,
      required: [true, 'Field type is required'],
      enum: {
        values: ['text', 'number', 'date', 'boolean', 'list'],
        message: '{VALUE} is not a valid field type',
      },
    },
    required: {
      type: Boolean,
      default: false,
    },
    listOptions: {
      type: [String],
      default: undefined,
      validate: {
        validator: function (this: ICustomFieldDocument, value: string[] | undefined): boolean {
          return this.type !== 'list' || (Array.isArray(value) && value.length > 0);
        },
        message: 'List options are required for LIST type fields',
      },
    },
    defaultValue: {
      type: Schema.Types.Mixed,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot be longer than 500 characters'],
    },
    validation: {
      type: validationSchema,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: true,
  },
);

// Performance optimized indexes
customFieldSchema.index({ name: 1 }, { unique: true });
customFieldSchema.index({ type: 1 });
customFieldSchema.index({ createdAt: -1 });

/**
 * Pre-save middleware to validate default value based on field type
 */
customFieldSchema.pre('save', function (next): void {
  if (this.defaultValue !== undefined) {
    try {
      switch (this.type) {
        case 'number':
          if (typeof this.defaultValue !== 'number') {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 'Default value must be a number', 400);
          }
          if (this.validation) {
            const { min, max } = this.validation;
            if (min !== undefined && this.defaultValue < min) {
              throw new AppError(
                ErrorCode.VALIDATION_ERROR,
                `Default value must be greater than or equal to ${min}`,
                400,
              );
            }
            if (max !== undefined && this.defaultValue > max) {
              throw new AppError(
                ErrorCode.VALIDATION_ERROR,
                `Default value must be less than or equal to ${max}`,
                400,
              );
            }
          }
          break;

        case 'text':
          if (typeof this.defaultValue !== 'string') {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 'Default value must be a string', 400);
          }
          if (this.validation?.pattern) {
            const regex = new RegExp(this.validation.pattern);
            if (!regex.test(this.defaultValue)) {
              throw new AppError(
                ErrorCode.VALIDATION_ERROR,
                this.validation.message || 'Default value does not match the required pattern',
                400,
              );
            }
          }
          break;

        case 'date':
          if (
            !(this.defaultValue instanceof Date) &&
            isNaN(Date.parse(this.defaultValue as string))
          ) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              'Default value must be a valid date',
              400,
            );
          }
          break;

        case 'boolean':
          if (typeof this.defaultValue !== 'boolean') {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 'Default value must be a boolean', 400);
          }
          break;

        case 'list':
          if (!this.listOptions?.includes(this.defaultValue as string)) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              'Default value must be one of the list options',
              400,
            );
          }
          break;
      }
    } catch (error) {
      return next(error as Error);
    }
  }
  next();
});

/**
 * Pre-save validation for required list options
 */
customFieldSchema.pre('save', function (next): void {
  if (this.type === 'list' && (!this.listOptions || this.listOptions.length === 0)) {
    const error = new AppError(
      ErrorCode.VALIDATION_ERROR,
      'List options are required for LIST type fields',
      400,
    );
    return next(error);
  }
  next();
});

/**
 * Pre-save validation for field name format and reserved words
 */
customFieldSchema.pre('save', function (next): void {
  const reservedWords = [
    '_id',
    'id',
    'name',
    'phoneNumber',
    'countryCode',
    'assignedAdmin',
    'status',
    'groups',
    'tags',
    'lastActivity',
    'metadata',
    'createdAt',
    'updatedAt',
    'new',
    'constructor',
    'prototype',
  ];

  if (reservedWords.includes(this.name)) {
    const error = new AppError(
      ErrorCode.VALIDATION_ERROR,
      `'${this.name}' is a reserved field name`,
      400,
    );
    return next(error);
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(this.name)) {
    const error = new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Field name must start with a letter, contain only letters, numbers, and underscores, and be less than 64 characters',
      400,
    );
    return next(error);
  }

  next();
});

/**
 * Instance method to validate a value against field constraints
 */
customFieldSchema.methods.validateValue = function (value: unknown): void {
  if (this.required && value === undefined) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field ${this.name} is required`, 400);
  }

  if (value !== undefined) {
    switch (this.type) {
      case 'number':
        if (typeof value !== 'number') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, `${this.name} must be a number`, 400);
        }
        if (this.validation) {
          const { min, max } = this.validation;
          if (min !== undefined && value < min) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `${this.name} must be greater than or equal to ${min}`,
              400,
            );
          }
          if (max !== undefined && value > max) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `${this.name} must be less than or equal to ${max}`,
              400,
            );
          }
        }
        break;

      case 'text':
        if (typeof value !== 'string') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, `${this.name} must be a string`, 400);
        }
        if (this.validation?.pattern) {
          const regex = new RegExp(this.validation.pattern);
          if (!regex.test(value)) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              this.validation.message || `${this.name} does not match the required pattern`,
              400,
            );
          }
        }
        break;

      case 'date':
        if (!(value instanceof Date) && isNaN(Date.parse(value as string))) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, `${this.name} must be a valid date`, 400);
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, `${this.name} must be a boolean`, 400);
        }
        break;

      case 'list':
        if (!this.listOptions?.includes(value as string)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `${this.name} must be one of: ${this.listOptions?.join(', ')}`,
            400,
          );
        }
        break;
    }
  }
};

export const CustomFieldModel = model<ICustomFieldDocument>('CustomField', customFieldSchema);
