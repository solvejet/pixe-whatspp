// src/models/user.model.ts
import { Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
import type { IUserDocument } from '@/types/auth.js';
import { RoleModel } from './role.model.js';

const userSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    roles: [
      {
        type: String,
        required: true,
      },
    ],
    permissions: [
      {
        type: String,
      },
    ],
  },
  {
    timestamps: true,
  },
);

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Add method to sync permissions
userSchema.methods.syncPermissions = async function (): Promise<void> {
  const roles = await RoleModel.find({ name: { $in: this.roles } });
  this.permissions = [...new Set(roles.flatMap((role) => role.permissions))];
};

userSchema.pre('save', async function (next) {
  try {
    // Handle password hashing
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // Sync permissions if roles have changed
    if (this.isModified('roles')) {
      await this.syncPermissions();
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

export const UserModel = model<IUserDocument>('User', userSchema);
