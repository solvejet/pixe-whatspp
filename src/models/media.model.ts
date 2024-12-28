// src/models/media.model.ts
import { Schema, model, type Document, type Types } from 'mongoose';
import type { WithTimestamps } from '@/types/mongoose.js';

export enum MediaStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  FAILED = 'failed',
  DELETED = 'deleted',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
}

// Define the metadata map type for better type safety
export type MetadataMap = Map<string, unknown>;

// Base interface for the media document without Mongoose methods
export interface IMedia extends WithTimestamps {
  originalName: string;
  mimeType: string;
  size: number;
  type: MediaType;
  path: string;
  whatsappMediaId?: string;
  url?: string;
  sha256?: string;
  status: MediaStatus;
  uploadedBy: Types.ObjectId;
  error?: string;
  metadata?: MetadataMap;
}

// Interface including Mongoose Document methods
export interface IMediaDocument extends IMedia, Document {
  _id: Types.ObjectId;
}

// Interface for creating a new media document
export interface ICreateMedia {
  originalName: string;
  mimeType: string;
  size: number;
  type: MediaType;
  path: string;
  status: MediaStatus;
  uploadedBy: Types.ObjectId;
}

const mediaSchema = new Schema<IMediaDocument>(
  {
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      index: true,
    },
    size: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(MediaType),
      required: true,
      index: true,
    },
    path: {
      type: String,
      required: true,
    },
    whatsappMediaId: {
      type: String,
      sparse: true,
      index: true,
    },
    url: String,
    sha256: String,
    status: {
      type: String,
      enum: Object.values(MediaStatus),
      default: MediaStatus.PENDING,
      required: true,
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    error: String,
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: (): MetadataMap => new Map(),
    },
  },
  {
    timestamps: true,
  },
);

// Add timestamps option for automatic createdAt and updatedAt fields
mediaSchema.set('timestamps', true);

// Indexes for performance optimization
mediaSchema.index({ uploadedBy: 1, status: 1 });
mediaSchema.index({ createdAt: -1, status: 1 });
mediaSchema.index({ type: 1, status: 1 });

// Static methods - can be added here if needed
mediaSchema.statics = {
  // Add static methods as needed
};

// Instance methods - can be added here if needed
mediaSchema.methods = {
  // Add instance methods as needed
};

/**
 * Media Model
 * @description Represents media files in the system with support for WhatsApp integration
 */
export const MediaModel = model<IMediaDocument>('Media', mediaSchema);
