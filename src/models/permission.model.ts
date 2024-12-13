// src/models/permission.model.ts
import { Schema, model } from 'mongoose';
import type { IPermission } from '@/types/auth.js';

const permissionSchema = new Schema<IPermission>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
    },
    resource: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'manage'],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const PermissionModel = model<IPermission>('Permission', permissionSchema);
