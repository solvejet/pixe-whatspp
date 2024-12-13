// src/models/audit.model.ts
import { Schema, model } from 'mongoose';
import type { IAuditLog } from '@/types/audit.js';

const auditLogSchema = new Schema<IAuditLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['auth', 'user', 'system', 'data', 'security'],
      required: true,
      index: true,
    },
    details: {
      type: Schema.Types.Mixed,
      required: true,
    },
    ipAddress: {
      type: String,
      required: true,
      index: true,
    },
    userAgent: {
      browser: String,
      version: String,
      os: String,
      platform: String,
    },
    status: {
      type: String,
      enum: ['success', 'failure'],
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    // Optimize for write-heavy operations
    capped: { size: 100000000, max: 50000 }, // 100MB, 50K documents
  },
);

// Create compound indexes for common queries
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, status: 1, createdAt: -1 });

export const AuditLogModel = model<IAuditLog>('AuditLog', auditLogSchema);
