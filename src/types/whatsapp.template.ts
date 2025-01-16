// src/types/whatsapp.template.ts

import type { Types } from 'mongoose';
import type { WithTimestamps } from './mongoose.js';

/**
 * WhatsApp Template Component Types
 */
export enum WhatsAppTemplateComponentType {
  HEADER = 'header',
  BODY = 'body',
  FOOTER = 'footer',
  BUTTONS = 'button',
}

export enum WhatsAppTemplateStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
}

export enum WhatsAppTemplateCategory {
  MARKETING = 'MARKETING',
  UTILITY = 'UTILITY',
  AUTHENTICATION = 'AUTHENTICATION',
  TICKET_UPDATE = 'TICKET_UPDATE',
  ISSUE_RESOLUTION = 'ISSUE_RESOLUTION',
  TRANSACTIONAL = 'TRANSACTIONAL',
}

export enum WhatsAppParameterType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  CURRENCY = 'currency',
  DATE_TIME = 'date_time',
  PAYLOAD = 'payload',
}

/**
 * Template Parameter Interfaces
 */
export interface WhatsAppTemplateParameter {
  type: WhatsAppParameterType;
  [key: string]: unknown;
}

export interface WhatsAppTextParameter extends WhatsAppTemplateParameter {
  type: WhatsAppParameterType.TEXT;
  text: string;
}

export interface WhatsAppMediaParameter extends WhatsAppTemplateParameter {
  type: WhatsAppParameterType.IMAGE | WhatsAppParameterType.VIDEO | WhatsAppParameterType.DOCUMENT;
  media: {
    link: string;
    filename?: string;
  };
}

export interface WhatsAppCurrencyParameter extends WhatsAppTemplateParameter {
  type: WhatsAppParameterType.CURRENCY;
  currency: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
}

export interface WhatsAppDateTimeParameter extends WhatsAppTemplateParameter {
  type: WhatsAppParameterType.DATE_TIME;
  date_time: {
    fallback_value: string;
    timestamp?: number;
  };
}

/**
 * Template Component Interface
 */
export interface WhatsAppTemplateComponent {
  type: WhatsAppTemplateComponentType;
  text?: string;
  parameters?: WhatsAppTemplateParameter[];
  sub_type?: 'quick_reply' | 'url';
  index?: number;
}

/**
 * Template Language Interface
 */
export interface WhatsAppTemplateLanguage {
  code: string;
  policy?: string;
}

/**
 * Template Base Interface
 */
export interface IWhatsAppTemplate extends WithTimestamps {
  name: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
  language: WhatsAppTemplateLanguage;
  status: WhatsAppTemplateStatus;
  whatsappTemplateId?: string;
  metadata?: Map<string, unknown>;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
}

/**
 * Template Request/Response DTOs
 */
export interface CreateTemplateRequest {
  name: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
  language: WhatsAppTemplateLanguage;
  metadata?: Record<string, unknown>;
}

export interface UpdateTemplateRequest {
  category?: WhatsAppTemplateCategory;
  components?: WhatsAppTemplateComponent[];
  language?: WhatsAppTemplateLanguage;
  metadata?: Record<string, unknown>;
}

export interface TemplateResponse {
  id: string;
  name: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
  language: WhatsAppTemplateLanguage;
  status: WhatsAppTemplateStatus;
  whatsappTemplateId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListResponse {
  templates: TemplateResponse[];
  total: number;
  page: number;
  pages: number;
}

/**
 * WhatsApp API Response Types
 */
export interface WhatsAppAPITemplateResponse {
  name: string;
  components: WhatsAppTemplateComponent[];
  language: string;
  status: WhatsAppTemplateStatus;
  category: WhatsAppTemplateCategory;
  id: string;
}
