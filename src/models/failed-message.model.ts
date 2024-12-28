// src/models/failed-message.model.ts
import { Schema, model } from 'mongoose';
import type { MessageType } from '@/types/whatsapp.js';

interface IFailedMessage {
  messageId?: string;
  to: string;
  type: MessageType;
  content: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  retryCount: number;
  lastRetryAt?: Date;
  createdAt: Date;
  status: 'pending_retry' | 'failed' | 'resolved';
  metadata?: Record<string, unknown>;
}

const failedMessageSchema = new Schema<IFailedMessage>({
  messageId: String,
  to: { type: String, required: true },
  type: { type: String, required: true },
  content: { type: Schema.Types.Mixed, required: true },
  error: {
    code: { type: String, required: true },
    message: { type: String, required: true },
    details: Schema.Types.Mixed,
  },
  retryCount: { type: Number, default: 0 },
  lastRetryAt: Date,
  createdAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['pending_retry', 'failed', 'resolved'],
    default: 'pending_retry',
  },
  metadata: Schema.Types.Mixed,
});

export const FailedMessageModel = model<IFailedMessage>('FailedMessage', failedMessageSchema);
