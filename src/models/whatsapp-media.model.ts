// src/models/whatsapp-media.model.ts

import { Schema, model, type Document } from 'mongoose';
import type { IWhatsAppMedia } from '../types/whatsapp.media.js';
import { WhatsAppMediaType } from '../types/whatsapp.media.js';

export interface IWhatsAppMediaDocument extends IWhatsAppMedia, Document {
  createdAt: Date;
  updatedAt: Date;
}

const whatsappMediaSchema = new Schema<IWhatsAppMediaDocument>(
  {
    whatsappMediaId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(WhatsAppMediaType),
      required: true,
      index: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    sha256: {
      type: String,
      required: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'deleted'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
whatsappMediaSchema.index({ createdAt: -1 });
whatsappMediaSchema.index({ status: 1, type: 1 });

export const WhatsAppMediaModel = model<IWhatsAppMediaDocument>(
  'WhatsAppMedia',
  whatsappMediaSchema,
);
