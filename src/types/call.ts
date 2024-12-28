// src/types/call.ts

import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import type { CallStatus } from '@/models/call.model.js';
import type { ParsedQs } from 'qs';

// Base interface for call requests
export interface CallRequestBase extends AuthenticatedRequest {
  user: NonNullable<AuthenticatedRequest['user']>; // Ensure user is not undefined
}

// Request body interfaces
export interface InitiateCallBody {
  customerId: string;
  phoneNumber: string;
  customField?: string;
  timeLimit?: number;
  recordingFormat?: string;
  recordingChannels?: string;
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

// Query parameters interface
export interface CallQueryParams extends ParsedQs {
  page?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
  status?: CallStatus;
}

// Request type definitions
export interface InitiateCallRequest extends CallRequestBase {
  body: InitiateCallBody;
}

export interface WebhookRequest extends Request {
  body: CallbackBody;
}

export interface CustomerCallHistoryRequest extends CallRequestBase {
  params: { customerId: string };
  query: CallQueryParams;
}

export interface StaffCallHistoryRequest extends CallRequestBase {
  query: CallQueryParams;
}

export interface CallByIdRequest extends CallRequestBase {
  params: { id: string };
}

export interface CallStatsRequest extends CallRequestBase {
  query: {
    startDate?: string;
    endDate?: string;
  };
}

// Response types
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
