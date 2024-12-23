// src/schemas/auth.schema.ts
import { z } from 'zod';
import { Role } from '@/types/auth.js';

export const authSchemas = {
  register: z.object({
    body: z.object({
      email: z.string().email('Invalid email format'),
      password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .max(100, 'Password is too long')
        .regex(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
          'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
        ),
      firstName: z
        .string()
        .min(2, 'First name must be at least 2 characters')
        .max(50, 'First name is too long'),
      lastName: z
        .string()
        .min(2, 'Last name must be at least 2 characters')
        .max(50, 'Last name is too long'),
      roles: z.array(z.nativeEnum(Role)).optional().default([Role.USER]),
      deviceInfo: z
        .object({
          deviceId: z.string().optional(),
          deviceType: z.string().optional(),
          deviceName: z.string().optional(),
          platform: z.string().optional(),
          browserName: z.string().optional(),
          browserVersion: z.string().optional(),
          location: z.string().optional(),
        })
        .optional(),
    }),
  }),

  login: z.object({
    body: z.object({
      email: z.string().email('Invalid email format'),
      password: z.string().min(1, 'Password is required'),
      deviceInfo: z
        .object({
          deviceId: z.string().optional(),
          deviceType: z.string().optional(),
          deviceName: z.string().optional(),
          platform: z.string().optional(),
          browserName: z.string().optional(),
          browserVersion: z.string().optional(),
          location: z.string().optional(),
        })
        .optional(),
    }),
  }),

  refreshToken: z.object({
    body: z.object({
      refreshToken: z.string().min(1, 'Refresh token is required'),
      deviceInfo: z
        .object({
          deviceId: z.string().optional(),
          deviceType: z.string().optional(),
          deviceName: z.string().optional(),
          platform: z.string().optional(),
          browserName: z.string().optional(),
          browserVersion: z.string().optional(),
          location: z.string().optional(),
        })
        .optional(),
    }),
  }),

  logout: z.object({
    body: z.object({
      refreshToken: z.string().min(1, 'Refresh token is required'),
      allDevices: z.boolean().optional().default(false),
    }),
  }),
};
