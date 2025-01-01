// src/types/call.ts

import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { WithTimestamps } from './mongoose.js';
import type { AuthenticatedRequest } from './auth.js';
import type { ParsedQs } from 'qs';
import type { IncomingHttpHeaders } from 'http';

/**
 * Call Status Enum
 * Represents all possible states of a call
 */
export enum CallStatus {
  INITIATED = 'initiated',
  QUEUED = 'queued',
  RINGING = 'ringing',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy',
  CANCELED = 'canceled',
}

/**
 * Call Type Enum
 * Represents the direction of the call
 */
export enum CallType {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

/**
 * Call Recording Format Enum
 */
export enum CallRecordingFormat {
  MP3 = 'mp3',
  MP3_HQ = 'mp3-hq',
}

/**
 * Call Recording Channels Enum
 */
export enum CallRecordingChannels {
  SINGLE = 'single',
  DUAL = 'dual',
}

/**
 * Base Call Interface
 */
export interface ICall extends WithTimestamps {
  customerId: Types.ObjectId;
  staffId: Types.ObjectId;
  from: string;
  to: string;
  callerId: string;
  callSid: string;
  status: CallStatus;
  type: CallType;
  duration: number;
  startTime: Date;
  endTime?: Date;
  recordingUrl?: string;
  recordingDuration?: number;
  recordingFormat: CallRecordingFormat;
  recordingChannels: CallRecordingChannels;
  price?: number;
  currency?: string;
  direction: string;
  answeredBy?: string;
  customField?: string;
  metadata: Map<string, unknown>;
  logs: Array<{
    timestamp: Date;
    event: string;
    data: Record<string, unknown>;
  }>;
}

/**
 * Call Request Types
 */
export interface InitiateCallBody {
  customerId: string;
  phoneNumber: string;
  customField?: string;
  timeLimit?: number;
  recordingFormat?: CallRecordingFormat;
  recordingChannels?: CallRecordingChannels;
}

export interface CallbackBody {
  CallSid: string;
  Status: string;
  RecordingUrl?: string;
  RecordingDuration?: string;
  Direction: string;
  From: string;
  To: string;
  DialCallStatus: string;
  Price?: string;
  Currency?: string;
}

/**
 * Call Query Parameters with validation
 */
export interface CallQueryParams extends ParsedQs {
  page?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
  status?: CallStatus;
}

/**
 * Request Types with proper Express request extension
 */
export interface InitiateCallRequest extends Request {
  user: NonNullable<AuthenticatedRequest['user']>;
  body: InitiateCallBody;
  params: Record<string, string>;
}

/**
 * Extended HTTP headers for Exotel webhooks
 */
export interface WebhookHeaders extends IncomingHttpHeaders {
  'x-exotel-signature': string;
  'x-exotel-timestamp': string;
}

/**
 * Webhook request with required headers and body
 */
export interface WebhookRequest extends Request {
  headers: WebhookHeaders;
  body: CallbackBody;
}

export interface CustomerCallHistoryRequest extends Request {
  user: NonNullable<AuthenticatedRequest['user']>;
  params: {
    customerId: string;
  };
  query: CallQueryParams;
}

export interface StaffCallHistoryRequest extends Request {
  user: NonNullable<AuthenticatedRequest['user']>;
  params: Record<string, string>;
  query: CallQueryParams;
}

export interface CallByIdRequest extends Request {
  user: NonNullable<AuthenticatedRequest['user']>;
  params: {
    id: string;
  };
  query: ParsedQs;
}

export interface CallStatsRequest extends Request {
  user: NonNullable<AuthenticatedRequest['user']>;
  params: Record<string, string>;
  query: {
    startDate?: string;
    endDate?: string;
  };
}

/**
 * Response Types
 */
export interface CallResponse {
  id: string;
  customerId: string;
  staffId: string;
  from: string;
  to: string;
  callerId: string;
  callSid: string;
  status: CallStatus;
  duration: number;
  startTime: string;
  endTime?: string;
  recordingUrl?: string;
  recordingDuration?: number;
  price?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface CallStatistics {
  byStatus: Array<{
    status: CallStatus;
    count: number;
    totalDuration: number;
    averageDuration: number;
    totalCost: number;
  }>;
  summary: {
    totalCalls: number;
    totalDuration: number;
    totalCost: number;
    avgCallDuration: number;
  };
  dateRange: {
    start: Date;
    end: Date;
  };
}

/**
 * Service Types
 */
export interface CallServiceConfig {
  maxDuration: number;
  maxRetries: number;
  retryDelay: number;
  webhookSecret: string;
  defaultRecordingFormat: CallRecordingFormat;
  defaultRecordingChannels: CallRecordingChannels;
  pricePerMinute: number;
  currency: string;
  timeoutSeconds: number;
}

export interface CallMetrics {
  totalCalls: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  costPerCall: number;
  totalCost: number;
  callsByStatus: Record<CallStatus, number>;
}

/**
 * Webhook Types
 */
export interface CallWebhookPayload {
  event: string;
  timestamp: string;
  callSid: string;
  [key: string]: unknown;
}

export interface CallStatusCallback {
  callSid: string;
  status: CallStatus;
  duration?: number;
  recordingUrl?: string;
  price?: number;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Type Guards
 */
export function isWebhookRequest(req: Request): req is WebhookRequest {
  return (
    'x-exotel-signature' in req.headers &&
    'x-exotel-timestamp' in req.headers &&
    typeof req.headers['x-exotel-signature'] === 'string' &&
    typeof req.headers['x-exotel-timestamp'] === 'string' &&
    req.headers['x-exotel-signature'].length > 0 &&
    req.headers['x-exotel-timestamp'].length > 0
  );
}

/**
 * Helper function to validate phone numbers
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  return /^\+?[1-9]\d{1,14}$/.test(phoneNumber);
}

/**
 * Helper function to validate call duration
 */
export function isValidCallDuration(duration: number, maxDuration: number): boolean {
  return duration >= 0 && duration <= maxDuration;
}

/**
 * Helper function to parse webhook timestamp
 */
export function parseWebhookTimestamp(timestamp: string): Date | null {
  const parsed = parseInt(timestamp, 10);
  if (isNaN(parsed)) return null;
  return new Date(parsed * 1000); // Convert from Unix timestamp
}

/**
 * Helper function to validate webhook age
 */
export function isWebhookTimestampValid(timestamp: string, maxAgeMinutes = 5): boolean {
  const parsedDate = parseWebhookTimestamp(timestamp);
  if (!parsedDate) return false;

  const now = Date.now();
  const timestampMs = parsedDate.getTime();
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  return Math.abs(now - timestampMs) <= maxAgeMs;
}
