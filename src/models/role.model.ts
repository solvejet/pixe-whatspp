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

export const RoleModel = model<IRole>('Role', roleSchema);
