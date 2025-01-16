// src/types/whatsapp.chat.ts

import { Schema, model, type Model, type Document, type Types } from 'mongoose';
import { Redis } from '@/config/redis.js';
import { logger } from '@/utils/logger.js';
import type { MessageType } from '@/types/whatsapp.chat.js';

// Message content union type
export type MessageContent =
  | { text: { body: string } }
  | {
      image: {
        id: string;
        caption?: string;
        mime_type: string;
        sha256?: string;
      };
    }
  | {
      video: {
        id: string;
        caption?: string;
        mime_type: string;
        sha256?: string;
      };
    }
  | {
      audio: {
        id: string;
        mime_type: string;
        sha256?: string;
        voice?: boolean;
      };
    }
  | {
      document: {
        id: string;
        caption?: string;
        filename: string;
        mime_type: string;
        sha256?: string;
      };
    }
  | {
      location: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
      };
    }
  | {
      contacts: Array<{
        addresses?: Array<{
          city?: string;
          country?: string;
          country_code?: string;
          state?: string;
          street?: string;
          type?: 'HOME' | 'WORK';
          zip?: string;
        }>;
        birthday?: string;
        emails?: Array<{
          email: string;
          type?: 'HOME' | 'WORK';
        }>;
        name: {
          formatted_name: string;
          first_name?: string;
          last_name?: string;
          middle_name?: string;
          suffix?: string;
          prefix?: string;
        };
        org?: {
          company?: string;
          department?: string;
          title?: string;
        };
        phones?: Array<{
          phone: string;
          type?: 'HOME' | 'WORK';
          wa_id?: string;
        }>;
        urls?: Array<{
          url: string;
          type?: 'HOME' | 'WORK';
        }>;
      }>;
    }
  | {
      interactive: {
        type: 'button_reply' | 'list_reply';
        button_reply?: {
          id: string;
          title: string;
        };
        list_reply?: {
          id: string;
          title: string;
          description?: string;
        };
      };
    }
  | {
      reaction: {
        message_id: string;
        emoji: string;
      };
    }
  | {
      button: {
        payload?: string;
        text: string;
      };
    };
/**
 * Base interface for chat message
 */
export interface IChatMessageBase {
  customerId: Types.ObjectId;
  adminId: Types.ObjectId;
  whatsappMessageId: string;
  type: MessageType;
  content: MessageContent;
  metadata: Map<string, unknown>;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  conversationId?: string;
  templateId?: string;
  useTemplate: boolean;
  windowExpiresAt?: Date;
  referral?: {
    source_url: string;
    source_id: string;
    source_type: 'ad' | 'post';
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid: string;
  };
}

export interface IChatMessage extends IChatMessageBase {
  _id: Types.ObjectId;
}

/**
 * Interface for the Mongoose document
 */
export interface IChatMessageDocument extends Document, IChatMessageBase {
  _id: Types.ObjectId;
  toObject(): IChatMessage;
  updateMessageStatus(status: IChatMessage['status']): Promise<void>;
}

/**
 * Model interface with static methods
 */
interface IChatMessageModel extends Model<IChatMessageDocument> {
  isWithinWindow(customerId: Types.ObjectId): Promise<boolean>;
  updateConversationWindow(
    customerId: Types.ObjectId,
    direction: IChatMessage['direction'],
  ): Promise<Date>;
  getChatHistory(
    customerId: Types.ObjectId,
    limit?: number,
    before?: Date,
  ): Promise<IChatMessageDocument[]>;
  getActiveChats(
    adminId: Types.ObjectId,
  ): Promise<Array<{ customerId: Types.ObjectId; lastMessage: IChatMessageDocument }>>;
}

// Your existing constants
const CONVERSATION_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const WINDOW_KEY_PREFIX = 'chat:window:';

/**
 * Chat message schema definition
 */
const chatMessageSchema = new Schema<IChatMessageDocument, IChatMessageModel>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    whatsappMessageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'text',
        'image',
        'video',
        'audio',
        'document',
        'location',
        'contacts',
        'interactive',
        'button',
        'reaction',
        'template',
        'unknown',
      ],
      index: true,
    },
    content: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: function (v: unknown): boolean {
          // Basic validation that content matches the type
          if (!v || typeof v !== 'object') return false;
          const obj = v as Record<string, unknown>;
          return this.type in obj;
        },
      },
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: (): Map<string, unknown> => new Map(),
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      required: true,
      default: 'sent',
      index: true,
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      index: true,
    },
    templateId: {
      type: String,
      sparse: true,
      index: true,
    },
    useTemplate: {
      type: Boolean,
      default: false,
      index: true,
    },
    windowExpiresAt: {
      type: Date,
      index: true,
    },
    referral: {
      type: {
        source_url: String,
        source_id: String,
        source_type: {
          type: String,
          enum: ['ad', 'post'],
        },
        headline: String,
        body: String,
        media_type: String,
        image_url: String,
        video_url: String,
        thumbnail_url: String,
        ctwa_clid: String,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Your existing indexes
chatMessageSchema.index({ customerId: 1, timestamp: -1 });
chatMessageSchema.index({ adminId: 1, timestamp: -1 });
chatMessageSchema.index({ customerId: 1, status: 1 });
chatMessageSchema.index({ customerId: 1, windowExpiresAt: 1 });

// Your existing methods
chatMessageSchema.methods.updateMessageStatus = async function (
  this: IChatMessageDocument,
  status: IChatMessage['status'],
): Promise<void> {
  this.status = status;
  if (status === 'failed') {
    logger.warn('Message status failed:', {
      whatsappMessageId: this.whatsappMessageId,
      customerId: this.customerId,
      adminId: this.adminId,
    });
  }
  await this.save();
};

chatMessageSchema.statics.isWithinWindow = async function (
  customerId: Types.ObjectId,
): Promise<boolean> {
  const windowKey = `${WINDOW_KEY_PREFIX}${customerId.toString()}`;
  const expiryTime = await Redis.get(windowKey);

  return !!expiryTime && new Date(expiryTime) > new Date();
};

chatMessageSchema.statics.updateConversationWindow = async function (
  customerId: Types.ObjectId,
  direction: IChatMessage['direction'],
): Promise<Date> {
  const windowKey = `${WINDOW_KEY_PREFIX}${customerId.toString()}`;
  const now = new Date();
  const expiryTime = new Date(now.getTime() + CONVERSATION_WINDOW);

  if (direction === 'inbound' || !(await Redis.get(windowKey))) {
    await Redis.setEx(windowKey, CONVERSATION_WINDOW / 1000, expiryTime.toISOString());
  }

  return expiryTime;
};

chatMessageSchema.statics.getChatHistory = async function (
  customerId: Types.ObjectId,
  limit = 50,
  before?: Date,
): Promise<IChatMessageDocument[]> {
  const query: Record<string, unknown> = { customerId };
  if (before) {
    query.timestamp = { $lt: before };
  }

  const messages = await this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('adminId', 'firstName lastName')
    .lean()
    .exec();

  return messages.map((msg) => ({
    ...msg,
    metadata: new Map(Object.entries(msg.metadata || {})),
  })) as IChatMessageDocument[];
};

chatMessageSchema.statics.getActiveChats = async function (
  adminId: Types.ObjectId,
): Promise<Array<{ customerId: Types.ObjectId; lastMessage: IChatMessageDocument }>> {
  return await this.aggregate([
    {
      $match: {
        adminId,
        windowExpiresAt: { $gt: new Date() },
      },
    },
    {
      $sort: { timestamp: -1 },
    },
    {
      $group: {
        _id: '$customerId',
        lastMessage: { $first: '$$ROOT' },
      },
    },
    {
      $project: {
        _id: 0,
        customerId: '$_id',
        lastMessage: 1,
      },
    },
  ]);
};

// Your existing pre-save middleware
chatMessageSchema.pre('save', async function (this: IChatMessageDocument, next): Promise<void> {
  try {
    if (this.isNew) {
      const windowExpiry = await ChatMessageModel.updateConversationWindow(
        this.customerId,
        this.direction,
      );
      this.windowExpiresAt = windowExpiry;

      if (this._id) {
        await createChatLog({
          messageId: this._id,
          customerId: this.customerId,
          adminId: this.adminId,
          type: this.type,
          direction: this.direction,
          status: this.status,
          useTemplate: this.useTemplate,
          timestamp: this.timestamp,
        });
      }
    }
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error('Error in pre-save middleware'));
  }
});

// Your existing chat log related code
interface ChatLogEntry {
  messageId: Types.ObjectId;
  customerId: Types.ObjectId;
  adminId: Types.ObjectId;
  type: MessageType;
  direction: IChatMessage['direction'];
  status: IChatMessage['status'];
  useTemplate: boolean;
  timestamp: Date;
}

const chatLogSchema = new Schema(
  {
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatMessage',
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'text',
        'image',
        'video',
        'audio',
        'document',
        'location',
        'contacts',
        'interactive',
        'button',
        'reaction',
        'template',
        'unknown',
      ],
    },
    direction: {
      type: String,
      required: true,
      enum: ['inbound', 'outbound'],
    },
    status: {
      type: String,
      required: true,
      enum: ['sent', 'delivered', 'read', 'failed'],
    },
    useTemplate: {
      type: Boolean,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

chatLogSchema.index({ customerId: 1, timestamp: -1 });
chatLogSchema.index({ adminId: 1, timestamp: -1 });

const ChatLogModel = model('ChatLog', chatLogSchema);

const createChatLog = async (
  entry: Omit<ChatLogEntry, 'messageId'> & { messageId: Types.ObjectId },
): Promise<void> => {
  await ChatLogModel.create(entry);
};

export const ChatMessageModel = model<IChatMessageDocument, IChatMessageModel>(
  'ChatMessage',
  chatMessageSchema,
);

export { ChatLogModel, type ChatLogEntry };
