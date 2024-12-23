// src/models/role.model.ts
import { Schema, model } from 'mongoose';
import type { IRoleDocument } from '@/types/auth.js';

const roleSchema = new Schema<IRoleDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    permissions: [
      {
        type: String,
        ref: 'Permission',
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Add compound index for common queries
roleSchema.index({ name: 1, createdAt: -1 });

export const RoleModel = model<IRoleDocument>('Role', roleSchema);
