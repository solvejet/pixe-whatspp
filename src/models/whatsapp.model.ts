// src/models/whatsapp.model.ts

import { Schema, model } from 'mongoose';
import {
  ConversationType,
  MessageStatus,
  type IConversation,
  type IMessage,
  type ITemplate,
  MessageType,
} from '@/types/whatsapp.js';

const conversationSchema = new Schema<IConversation>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'closed'],
      default: 'active',
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(ConversationType),
      required: true,
      index: true,
    },
    lastMessageAt: {
      type: Date,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
  },
  {
    timestamps: true,
  },
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    from: {
      type: String,
      required: true,
      index: true,
    },
    to: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(MessageType),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(MessageStatus),
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    content: {
      type: {
        type: String,
        required: true,
      },
      data: Schema.Types.Mixed,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
  },
  {
    timestamps: true,
  },
);

const templateSchema = new Schema<ITemplate>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    language: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    components: [
      {
        type: {
          type: String,
          enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'],
          required: true,
        },
        text: String,
        format: {
          type: String,
          enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO'],
        },
        example: Schema.Types.Mixed,
      },
    ],
    variables: [
      {
        key: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ['text', 'image', 'document', 'video'],
          required: true,
        },
        source: {
          type: String,
          enum: ['customer', 'custom_field', 'static'],
          required: true,
        },
        field: String,
        value: String,
      },
    ],
    status: {
      type: String,
      enum: ['active', 'inactive', 'deleted'],
      default: 'active',
      index: true,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
conversationSchema.index({ status: 1, expiresAt: 1 });
conversationSchema.index({ customerId: 1, status: 1 });
conversationSchema.index({ businessId: 1, status: 1 });

messageSchema.index({ conversationId: 1, timestamp: -1 });
messageSchema.index({ from: 1, to: 1, timestamp: -1 });
messageSchema.index({ status: 1, timestamp: -1 });

templateSchema.index({ name: 1, language: 1, status: 1 });
templateSchema.index({ category: 1, status: 1 });

// Methods
conversationSchema.methods.isExpired = function (): boolean {
  return this.expiresAt <= new Date();
};

conversationSchema.methods.extendExpiry = function (hours = 24): void {
  this.expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
};

// Export models
export const ConversationModel = model<IConversation>('Conversation', conversationSchema);
export const MessageModel = model<IMessage>('Message', messageSchema);
export const TemplateModel = model<ITemplate>('Template', templateSchema);
