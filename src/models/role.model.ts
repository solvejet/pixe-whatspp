// src/models/role.model.ts
import { Schema, model } from 'mongoose';
import type { IRole } from '@/types/auth.js';

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true, // Add index for better query performance
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

export const RoleModel = model<IRole>('Role', roleSchema);
