// src/types/whatsapp.chat.ts
import type { Types } from 'mongoose';

// Contact-related interfaces
export interface ContactAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  type?: 'HOME' | 'WORK';
}

export interface ContactEmail {
  email: string;
  type?: 'HOME' | 'WORK';
}

export interface ContactName {
  formatted_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  prefix?: string;
}

export interface ContactOrg {
  company?: string;
  department?: string;
  title?: string;
}

export interface ContactPhone {
  phone: string;
  type?: 'HOME' | 'WORK' | 'CELL';
  wa_id?: string;
}

export interface ContactUrl {
  url: string;
  type?: 'HOME' | 'WORK';
}

// Base webhook types
export interface WhatsAppWebhook {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: WebhookValue;
      field: string;
    }>;
  }>;
}

export interface WebhookValue {
  messaging_product: 'whatsapp';
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: ContactInfo[];
  messages?: WebhookMessage[];
  statuses?: MessageStatus[];
}

export interface ContactInfo {
  profile: {
    name: string;
  };
  wa_id: string;
}

// Message types
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'template'
  | 'unknown';

export interface MessageContext {
  from: string;
  id: string;
  forwarded?: boolean;
  referred_product?: {
    catalog_id: string;
    product_retailer_id: string;
  };
}

export interface MediaContent {
  caption?: string | undefined;
  filename?: string | undefined;
  mime_type?: string | undefined;
  sha256?: string | undefined;
  id?: string | undefined;
  url?: string | undefined;
}

export interface LocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactContent {
  addresses?: ContactAddress[];
  birthday?: string;
  emails?: ContactEmail[];
  name: ContactName;
  org?: ContactOrg;
  phones?: ContactPhone[];
  urls?: ContactUrl[];
}

/**
 * WhatsApp Error Interface
 * Represents error information from WhatsApp API
 */
export interface WhatsAppError {
  code: string;
  message: string;
  details?: {
    [key: string]: unknown;
  };
}

// Status updates
export interface MessageStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: ConversationInfo;
  pricing?: PricingInfo;
  errors?: MessageError[];
}

export interface ConversationInfo {
  id: string;
  origin?: {
    type: string;
  };
  expiration_timestamp?: string;
}

export interface PricingInfo {
  billable: boolean;
  pricing_model: string;
  category: string;
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

// Interactive content types
export interface InteractiveContent {
  type: InteractiveType;
  button_reply?: {
    id: string;
    title: string;
  };
  list_reply?: {
    id: string;
    title: string;
    description?: string;
  };
}

export type InteractiveType = 'button_reply' | 'list_reply';

// Referral content (from ads)
export interface ReferralContent {
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
}

// Chat message model interfaces
export interface IChatMessage {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  adminId: Types.ObjectId;
  whatsappMessageId: string;
  type: MessageType;
  content: string | MediaContent | LocationContent | ContactContent | InteractiveContent;
  metadata?: Map<string, unknown>;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  conversationId?: string;
  templateId?: string;
  referral?: ReferralContent;
}

// Outbound message types
export interface SendMessageBase {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: MessageType;
}

export interface SendTextMessage extends SendMessageBase {
  type: 'text';
  text: {
    preview_url?: boolean;
    body: string;
  };
}

export interface SendMediaMessage extends SendMessageBase {
  type: 'image' | 'video' | 'audio' | 'document';
  image?: {
    id: string;
    caption?: string;
  };
  video?: {
    id: string;
    caption?: string;
  };
  audio?: {
    id: string;
    caption?: string;
  };
  document?: {
    id: string;
    caption?: string;
  };
}

export interface SendInteractiveMessage extends SendMessageBase {
  type: 'interactive';
  interactive: {
    type: 'button' | 'list' | 'cta_url';
    header?: {
      type: 'text' | 'image' | 'video' | 'document';
      [key: string]: unknown;
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: {
      buttons?: Array<{
        type: 'reply';
        reply: {
          id: string;
          title: string;
        };
      }>;
      sections?: Array<{
        title: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };
  };
}

export interface ReactionContent {
  message_id: string;
  emoji: string;
}

export interface ButtonContent {
  text: string;
  payload?: string;
}

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: MessageType;
  context?: MessageContext;
  text?: { body: string };
  reaction?: ReactionContent;
  image?: MediaContent;
  video?: MediaContent;
  audio?: MediaContent;
  document?: MediaContent;
  location?: LocationContent;
  contacts?: ContactContent[];
  interactive?: InteractiveContent;
  button?: ButtonContent;
  referral?: ReferralContent;
  errors?: MessageError[];
}

export type SendMessagePayload = SendTextMessage | SendMediaMessage | SendInteractiveMessage;
