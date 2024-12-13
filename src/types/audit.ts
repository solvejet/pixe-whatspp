// src/types/audit.ts
import type { Document, Types } from 'mongoose';

export interface IAuditLogData {
  userId: Types.ObjectId;
  action: string;
  category: 'auth' | 'user' | 'system' | 'data' | 'security';
  details: Record<string, unknown>;
  ipAddress: string;
  userAgent: {
    browser: string;
    version: string;
    os: string;
    platform: string;
  };
  status: 'success' | 'failure';
  createdAt: Date;
}

export interface IAuditLog extends IAuditLogData, Document {}

export interface IAuditService {
  log(params: {
    userId: string;
    action: string;
    category: IAuditLog['category'];
    details: Record<string, unknown>;
    ipAddress: string;
    userAgent: string;
    status: IAuditLog['status'];
  }): Promise<void>;
}
