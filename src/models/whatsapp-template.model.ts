// src/models/whatsapp-template.model.ts

import { Schema, model, type Document, type Types } from 'mongoose';
import type {
  IWhatsAppTemplate,
  WhatsAppTemplateComponent,
  WhatsAppTemplateLanguage,
} from '@/types/whatsapp.template.js';
import {
  WhatsAppTemplateComponentType,
  WhatsAppTemplateStatus,
  WhatsAppTemplateCategory,
} from '@/types/whatsapp.template.js';

export interface IWhatsAppTemplateDocument extends IWhatsAppTemplate, Document {
  _id: Types.ObjectId;
}

const templateParameterSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
    },
    text: String,
    media: {
      link: String,
      filename: String,
    },
    currency: {
      fallback_value: String,
      code: String,
      amount_1000: Number,
    },
    date_time: {
      fallback_value: String,
      timestamp: Number,
    },
  },
  { _id: false },
);

const templateComponentSchema = new Schema<WhatsAppTemplateComponent>(
  {
    type: {
      type: String,
      enum: Object.values(WhatsAppTemplateComponentType),
      required: true,
    },
    text: String,
    parameters: [templateParameterSchema],
    sub_type: {
      type: String,
      enum: ['quick_reply', 'url'],
    },
    index: Number,
  },
  { _id: false },
);

const templateLanguageSchema = new Schema<WhatsAppTemplateLanguage>(
  {
    code: {
      type: String,
      required: true,
    },
    policy: String,
  },
  { _id: false },
);

const whatsappTemplateSchema = new Schema<IWhatsAppTemplateDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(WhatsAppTemplateCategory),
      required: true,
      index: true,
    },
    components: {
      type: [templateComponentSchema],
      required: true,
      validate: {
        validator: function (components: WhatsAppTemplateComponent[]): boolean {
          // Ensure at least one component exists
          if (components.length === 0) return false;

          // Validate button indices if buttons exist
          const buttons = components.filter(
            (c) => c.type === WhatsAppTemplateComponentType.BUTTONS,
          );
          if (buttons.length > 0) {
            const indices = buttons.map((b) => b.index).filter(Boolean) as number[];
            return indices.length === new Set(indices).size;
          }

          return true;
        },
        message: 'Template must have at least one component and button indices must be unique',
      },
    },
    language: {
      type: templateLanguageSchema,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(WhatsAppTemplateStatus),
      default: WhatsAppTemplateStatus.PENDING,
      index: true,
    },
    whatsappTemplateId: {
      type: String,
      sparse: true,
      index: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Create compound indexes for common queries
whatsappTemplateSchema.index({ name: 1, 'language.code': 1 }, { unique: true });
whatsappTemplateSchema.index({ status: 1, createdAt: -1 });
whatsappTemplateSchema.index({ category: 1, status: 1 });

export const WhatsAppTemplateModel = model<IWhatsAppTemplateDocument>(
  'WhatsAppTemplate',
  whatsappTemplateSchema,
);
