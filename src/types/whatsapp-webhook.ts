// src/types/whatsapp-webhook.ts

import { MessageType, MessageStatus, ConversationType, InteractiveType } from './whatsapp.js';

// Basic Message Components
export interface WhatsAppWebhookMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppWebhookContact {
  wa_id: string;
  profile: {
    name: string;
  };
}

// Media Components
export interface WhatsAppWebhookMedia {
  caption?: string;
  mime_type?: string;
  sha256?: string;
  id?: string;
  file_size?: number;
}

// Location Data
export interface WhatsAppWebhookLocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

// Contact Card Data
export interface WhatsAppWebhookAddress {
  city?: string;
  country?: string;
  country_code?: string;
  state?: string;
  street?: string;
  type?: 'HOME' | 'WORK';
  zip?: string;
}

export interface WhatsAppWebhookEmail {
  email: string;
  type?: 'HOME' | 'WORK';
}

export interface WhatsAppWebhookName {
  formatted_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  prefix?: string;
}

export interface WhatsAppWebhookOrg {
  company?: string;
  department?: string;
  title?: string;
}

export interface WhatsAppWebhookPhone {
  phone: string;
  wa_id?: string;
  type?: 'HOME' | 'WORK';
}

export interface WhatsAppWebhookUrl {
  url: string;
  type?: 'HOME' | 'WORK';
}

export interface WhatsAppWebhookContactData {
  addresses?: WhatsAppWebhookAddress[];
  birthday?: string;
  emails?: WhatsAppWebhookEmail[];
  name: WhatsAppWebhookName;
  org?: WhatsAppWebhookOrg;
  phones?: WhatsAppWebhookPhone[];
  urls?: WhatsAppWebhookUrl[];
}

// Interactive Message Components
export interface WhatsAppWebhookListReply {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppWebhookButtonReply {
  id: string;
  title: string;
}

export interface WhatsAppWebhookInteractiveData {
  type: InteractiveType;
  list_reply?: WhatsAppWebhookListReply;
  button_reply?: WhatsAppWebhookButtonReply;
}

// Referral Data
export interface WhatsAppWebhookReferralData {
  source_url?: string;
  source_id?: string;
  source_type?: 'ad' | 'post';
  headline?: string;
  body?: string;
  media_type?: 'image' | 'video';
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
}

// Error Details
export interface WhatsAppWebhookError {
  code: number;
  title: string;
  message?: string;
  error_data?: {
    details: string;
  };
  href?: string;
}

// Status Components
export interface WhatsAppWebhookConversation {
  id: string;
  expiration_timestamp?: string;
  origin?: {
    type: ConversationType;
  };
}

export interface WhatsAppWebhookPricing {
  billable: boolean;
  pricing_model: string;
  category: string;
}

// Message Context
export interface WhatsAppWebhookContext {
  from?: string;
  id?: string;
  forwarded?: boolean;
  frequently_forwarded?: boolean;
  referred_product?: {
    catalog_id: string;
    product_retailer_id: string;
  };
}

// Base Message Interface
export interface WhatsAppWebhookMessageBase {
  from: string;
  id: string;
  timestamp: string;
  context?: WhatsAppWebhookContext;
}

// Specific Message Types
export interface WhatsAppWebhookTextMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.TEXT;
  text: {
    body: string;
    preview_url?: boolean;
  };
}

export interface WhatsAppWebhookImageMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.IMAGE;
  image: WhatsAppWebhookMedia;
}

export interface WhatsAppWebhookVideoMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.VIDEO;
  video: WhatsAppWebhookMedia;
}

export interface WhatsAppWebhookAudioMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.AUDIO;
  audio: WhatsAppWebhookMedia;
}

export interface WhatsAppWebhookDocumentMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.DOCUMENT;
  document: WhatsAppWebhookMedia;
}

export interface WhatsAppWebhookLocationMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.LOCATION;
  location: WhatsAppWebhookLocationData;
}

export interface WhatsAppWebhookContactsMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.CONTACTS;
  contacts: WhatsAppWebhookContactData[];
}

export interface WhatsAppWebhookInteractiveMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.INTERACTIVE;
  interactive: WhatsAppWebhookInteractiveData;
}

export interface WhatsAppWebhookReactionMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.REACTION;
  reaction: {
    message_id: string;
    emoji: string;
  };
}

export interface WhatsAppWebhookButtonMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.BUTTON;
  button: {
    text: string;
    payload: string;
  };
}

export interface WhatsAppWebhookReferralMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.TEXT;
  referral: WhatsAppWebhookReferralData;
  text: {
    body: string;
  };
}

export interface WhatsAppWebhookTemplateMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.TEMPLATE;
  template: {
    name: string;
    language: {
      code: string;
    };
    components: Array<{
      type: string;
      parameters: Array<Record<string, unknown>>;
    }>;
  };
}

export interface WhatsAppWebhookErrorMessage extends WhatsAppWebhookMessageBase {
  type: MessageType.UNKNOWN;
  errors: WhatsAppWebhookError[];
}

// Union type for all possible message types
export type WhatsAppWebhookMessage =
  | WhatsAppWebhookTextMessage
  | WhatsAppWebhookImageMessage
  | WhatsAppWebhookVideoMessage
  | WhatsAppWebhookAudioMessage
  | WhatsAppWebhookDocumentMessage
  | WhatsAppWebhookLocationMessage
  | WhatsAppWebhookContactsMessage
  | WhatsAppWebhookInteractiveMessage
  | WhatsAppWebhookReactionMessage
  | WhatsAppWebhookButtonMessage
  | WhatsAppWebhookReferralMessage
  | WhatsAppWebhookTemplateMessage
  | WhatsAppWebhookErrorMessage;

// Status Updates
export interface WhatsAppWebhookStatus {
  id: string;
  status: MessageStatus;
  timestamp: string;
  recipient_id: string;
  conversation?: WhatsAppWebhookConversation;
  pricing?: WhatsAppWebhookPricing;
  errors?: WhatsAppWebhookError[];
}

// Business Profile Changes
export interface WhatsAppWebhookProfile {
  business_profile: {
    id: string;
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  };
}

// Webhook Entry Structure
export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: 'whatsapp';
      metadata: WhatsAppWebhookMetadata;
      contacts?: WhatsAppWebhookContact[];
      messages?: WhatsAppWebhookMessage[];
      statuses?: WhatsAppWebhookStatus[];
      profiles?: WhatsAppWebhookProfile[];
    };
    field: string;
  }>;
}

// Complete Webhook Payload
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppWebhookEntry[];
}

// Type Guards
export function isTextMessage(
  message: WhatsAppWebhookMessage,
): message is WhatsAppWebhookTextMessage {
  return message.type === MessageType.TEXT;
}
export function isMediaMessage(
  message: WhatsAppWebhookMessage,
): message is
  | WhatsAppWebhookImageMessage
  | WhatsAppWebhookVideoMessage
  | WhatsAppWebhookAudioMessage
  | WhatsAppWebhookDocumentMessage {
  return [MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT].includes(
    message.type,
  );
}

export function isInteractiveMessage(
  message: WhatsAppWebhookMessage,
): message is WhatsAppWebhookInteractiveMessage {
  return message.type === MessageType.INTERACTIVE;
}

export function isReferralMessage(
  message: WhatsAppWebhookMessage,
): message is WhatsAppWebhookReferralMessage {
  return 'referral' in message && message.type === MessageType.TEXT;
}

export function isTemplateMessage(
  message: WhatsAppWebhookMessage,
): message is WhatsAppWebhookTemplateMessage {
  return message.type === MessageType.TEMPLATE;
}
