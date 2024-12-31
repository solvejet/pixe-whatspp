// src/types/call.ts

import type { Request, ParamsDictionary } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import type { CallStatus } from '@/models/call.model.js';
import type { ParsedQs } from 'qs';

// Base interface for call requests
export interface CallRequestBase {
  user: NonNullable<AuthenticatedRequest['user']>;
}

// Query parameters interface
export interface CallQueryParams {
  page?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
  status?: CallStatus;
}

// Request type definitions with proper Express Request extension
export type InitiateCallRequest = Request
  Record<string, never>,
  unknown,
  InitiateCallBody,
  Record<string, never>
> & {
  user: NonNullable<AuthenticatedRequest['user']>;
};

export type WebhookRequest = Request
  Record<string, never>,
  unknown,
  CallbackBody,
  Record<string, never>
>;

export interface CustomerCallHistoryRequest extends Request
  { customerId: string },
  any,
  any,
  CallQueryParams
>, CallRequestBase {}

export interface StaffCallHistoryRequest extends Request
  ParamsDictionary,
  any,
  any,
  CallQueryParams
>, CallRequestBase {}

export interface CallByIdRequest extends Request
  { id: string },
  any,
  any,
  ParsedQs
>, CallRequestBase {}

export interface CallStatsRequest extends Request
  ParamsDictionary,
  any,
  any,
  {
    startDate?: string;
    endDate?: string;
  }
>, CallRequestBase {}

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

// Response types remain the same
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