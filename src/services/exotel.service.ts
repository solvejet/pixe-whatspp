// src/services/exotel.service.ts

import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { CallStatus, CallType, type ICallDocument, CallModel } from '@/models/call.model.js';
import type { Types } from 'mongoose';

interface ExotelCallResponse {
  success: boolean;
  callSid: string;
  message?: string;
  error?: string;
}

interface ExotelCallParams {
  from: string;
  to: string;
  callerId: string;
  customerId: Types.ObjectId;
  staffId: Types.ObjectId;
  recordingFormat?: string;
  recordingChannels?: string;
  customField?: string;
  timeLimit?: number;
}

interface ExotelCallbackEvent {
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

export class ExotelService {
  private static instance: ExotelService;
  private readonly baseUrl: string;
  private readonly accountSid: string;
  private readonly apiKey: string;
  private readonly apiToken: string;
  private readonly statusCallbackUrl: string;

  private constructor() {
    // Initialize with environment variables
    this.baseUrl = env.EXOTEL_API_URL;
    this.accountSid = env.EXOTEL_ACCOUNT_SID;
    this.apiKey = env.EXOTEL_API_KEY;
    this.apiToken = env.EXOTEL_API_TOKEN;
    this.statusCallbackUrl = `${env.API_BASE_URL}/api/v1/calls/callback`;
  }

  public static getInstance(): ExotelService {
    if (!ExotelService.instance) {
      ExotelService.instance = new ExotelService();
    }
    return ExotelService.instance;
  }

  /**
   * Initiate a call through Exotel
   */
  public async initiateCall(params: ExotelCallParams): Promise<ICallDocument> {
    try {
      const formData = new FormData();
      formData.append('From', params.from);
      formData.append('To', params.to);
      formData.append('CallerId', params.callerId);
      formData.append('Record', 'true');
      formData.append('RecordingFormat', params.recordingFormat || 'mp3');
      formData.append('RecordingChannels', params.recordingChannels || 'single');
      formData.append('StatusCallback', this.statusCallbackUrl);
      formData.append('StatusCallbackContentType', 'application/json');
      formData.append('StatusCallbackEvents[]', 'terminal');
      formData.append('StatusCallbackEvents[]', 'answered');

      if (params.customField) {
        formData.append('CustomField', params.customField);
      }

      if (params.timeLimit) {
        formData.append('TimeLimit', params.timeLimit.toString());
      }

      const authorization = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');

      const response = await fetch(`${this.baseUrl}/v1/Accounts/${this.accountSid}/Calls/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          'Failed to initiate call',
          response.status,
          true,
          {
            details: error,
          },
        );
      }

      const result = (await response.json()) as ExotelCallResponse;

      // Create call record in database
      const call = await CallModel.create({
        customerId: params.customerId,
        staffId: params.staffId,
        from: params.from,
        to: params.to,
        callerId: params.callerId,
        callSid: result.callSid,
        status: CallStatus.INITIATED,
        type: CallType.OUTBOUND,
        startTime: new Date(),
        direction: 'outbound',
        customField: params.customField,
      });

      return call;
    } catch (error) {
      logger.error('Error initiating call:', error);
      throw error instanceof AppError
        ? error
        : new AppError(ErrorCode.EXTERNAL_API_ERROR, 'Failed to initiate call', 500, false, {
            details: {
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          });
    }
  }

  /**
   * Handle callback events from Exotel
   */
  public async handleCallback(event: ExotelCallbackEvent): Promise<void> {
    try {
      const call = await CallModel.findOne({ callSid: event.CallSid });
      if (!call) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Call not found', 404);
      }

      // Update call status
      const status = this.mapExotelStatus(event.Status);
      await call.updateCallStatus(status);

      // Add recording details if available
      if (event.RecordingUrl && event.RecordingDuration) {
        await call.setRecordingDetails(event.RecordingUrl, parseInt(event.RecordingDuration, 10));
      }

      // Add pricing information if available
      if (event.Price && event.Currency) {
        call.price = parseFloat(event.Price);
        call.currency = event.Currency;
        await call.save();
      }

      // Convert event to a safe record type
      const eventData = this.convertEventToRecord(event);
      await call.addLog(event.Status, eventData);
    } catch (error) {
      logger.error('Error handling callback:', error);
      throw error;
    }
  }

  /**
   * Convert ExotelCallbackEvent to a safe Record type
   * @private
   */
  private convertEventToRecord(event: ExotelCallbackEvent): Record<string, unknown> {
    return Object.entries(event).reduce(
      (acc, [key, value]) => {
        // Only include defined values
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  /**
   * Map Exotel status to internal status
   */
  private mapExotelStatus(exotelStatus: string): CallStatus {
    switch (exotelStatus.toLowerCase()) {
      case 'queued':
      case 'in-progress':
        return CallStatus.IN_PROGRESS;
      case 'ringing':
        return CallStatus.RINGING;
      case 'completed':
        return CallStatus.COMPLETED;
      case 'failed':
        return CallStatus.FAILED;
      case 'no-answer':
        return CallStatus.NO_ANSWER;
      case 'busy':
        return CallStatus.BUSY;
      default:
        return CallStatus.FAILED;
    }
  }
}

export const exotelService = ExotelService.getInstance();
