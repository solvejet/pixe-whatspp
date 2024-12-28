// src/types/whatsapp.ts

import type { Types } from 'mongoose';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  LOCATION = 'location',
  CONTACTS = 'contacts',
  INTERACTIVE = 'interactive',
  TEMPLATE = 'template',
  REACTION = 'reaction',
  BUTTON = 'button',
  UNKNOWN = 'unknown',
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
  PENDING = 'pending',
  DELETED = 'deleted',
}

export enum ConversationType {
  CUSTOMER_INITIATED = 'customer_initiated',
  BUSINESS_INITIATED = 'business_initiated',
  REFERRAL_CONVERSION = 'referral_conversion',
}

export enum InteractiveType {
  BUTTON = 'button',
  LIST = 'list',
  PRODUCT = 'product',
  PRODUCT_LIST = 'product_list',
  CTA_URL = 'cta_url',
  ADDRESS_MESSAGE = 'address_message',
}

export interface WhatsAppMetadata {
  displayPhoneNumber: string;
  phoneNumberId: string;
}

export interface Contact {
  wa_id: string;
  profile: {
    name: string;
  };
}

export interface MessageError {
  code: number;
  title: string;
  message?: string;
  error_data?: {
    details: string;
  };
  href?: string;
}

export interface WhatsAppPayload {
  messaging_product: 'whatsapp';
  metadata: WhatsAppMetadata;
  contacts?: Contact[];
  messages?: WhatsAppMessage[];
  statuses?: MessageStatusUpdate[];
}

export interface Location {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface Media {
  id?: string;
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
  caption?: string;
}

export interface Button {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface InteractiveMessage {
  type: InteractiveType;
  header?: {
    type: string;
    text?: string;
    video?: Media;
    image?: Media;
    document?: Media;
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    button?: string;
    buttons?: Button[];
    sections?: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: MessageType;
  context?: {
    from?: string;
    id?: string;
  };
  text?: {
    body: string;
    preview_url?: boolean;
  };
  image?: Media;
  video?: Media;
  audio?: Media;
  document?: Media;
  location?: Location;
  contacts?: Contact[];
  interactive?: InteractiveMessage;
  reaction?: {
    message_id: string;
    emoji: string;
  };
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid?: string;
  };
}
export interface MessageStatusUpdate {
  id: string;
  status: MessageStatus;
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin?: {
      type: ConversationType;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: MessageError[];
}

// Database Models
export interface IConversation {
  customerId: Types.ObjectId;
  businessId: Types.ObjectId;
  status: 'active' | 'expired' | 'closed';
  type: ConversationType;
  lastMessageAt: Date;
  expiresAt: Date;
  metadata: Map<string, unknown>;
}

export interface IMessage {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  messageId: string;
  from: string;
  to: string;
  type: MessageType;
  status: MessageStatus;
  timestamp: Date;
  content: {
    type: MessageType;
    data: Record<string, unknown>;
  };
  metadata: Map<string, unknown>;
}

export interface ITemplate {
  name: string;
  language: string;
  category: string;
  components: Array<{
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    text?: string;
    format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
    example?: Record<string, unknown>;
  }>;
  variables: Array<{
    key: string;
    type: 'text' | 'image' | 'document' | 'video';
    source: 'customer' | 'custom_field' | 'static';
    field?: string;
    value?: string;
  }>;
  status: 'active' | 'inactive' | 'deleted';
  metadata: Map<string, unknown>;
}

// Variable Processing Types
export interface VariableMap {
  [key: string]: {
    value: unknown;
    source: 'customer' | 'custom_field' | 'static';
    type: 'text' | 'image' | 'document' | 'video';
  };
}

export interface ProcessedTemplate {
  content: string;
  variables: VariableMap;
  errors?: Array<{
    variable: string;
    error: string;
  }>;
}
