// src/models/call.model.ts
import { Schema, model, type Document, type Types } from 'mongoose';
import type { WithTimestamps } from '@/types/mongoose.js';

export enum CallStatus {
  INITIATED = 'initiated',
  RINGING = 'ringing',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy',
}

export enum CallType {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum CallRecordingFormat {
  MP3 = 'mp3',
  MP3_HQ = 'mp3-hq',
}

export enum CallRecordingChannels {
  SINGLE = 'single',
  DUAL = 'dual',
}

// Base interface for calls
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

// Interface for the Mongoose document
export interface ICallDocument extends ICall, Document {
  addLog(event: string, data: Record<string, unknown>): Promise<void>;
  updateCallStatus(status: CallStatus): Promise<void>;
  setRecordingDetails(url: string, duration: number): Promise<void>;
}

const callSchema = new Schema<ICallDocument>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    from: {
      type: String,
      required: true,
      trim: true,
    },
    to: {
      type: String,
      required: true,
      trim: true,
    },
    callerId: {
      type: String,
      required: true,
      trim: true,
    },
    callSid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CallStatus),
      default: CallStatus.INITIATED,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(CallType),
      required: true,
      index: true,
    },
    duration: {
      type: Number,
      default: 0,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
    },
    recordingUrl: String,
    recordingDuration: Number,
    recordingFormat: {
      type: String,
      enum: Object.values(CallRecordingFormat),
      default: CallRecordingFormat.MP3,
    },
    recordingChannels: {
      type: String,
      enum: Object.values(CallRecordingChannels),
      default: CallRecordingChannels.SINGLE,
    },
    price: Number,
    currency: String,
    direction: {
      type: String,
      required: true,
    },
    answeredBy: String,
    customField: String,
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
    logs: [
      {
        timestamp: {
          type: Date,
          default: Date.now,
        },
        event: String,
        data: Schema.Types.Mixed,
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
callSchema.index({ startTime: -1, status: 1 });
callSchema.index({ customerId: 1, startTime: -1 });
callSchema.index({ staffId: 1, startTime: -1 });
callSchema.index({ callSid: 1, status: 1 });

// Instance methods
callSchema.methods.addLog = async function (
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  this.logs.push({
    timestamp: new Date(),
    event,
    data,
  });
  await this.save();
};

callSchema.methods.updateCallStatus = async function (status: CallStatus): Promise<void> {
  this.status = status;
  if (status === CallStatus.COMPLETED || status === CallStatus.FAILED) {
    this.endTime = new Date();
    if (this.startTime) {
      this.duration = Math.floor((this.endTime.getTime() - this.startTime.getTime()) / 1000);
    }
  }
  await this.save();
};

callSchema.methods.setRecordingDetails = async function (
  url: string,
  duration: number,
): Promise<void> {
  this.recordingUrl = url;
  this.recordingDuration = duration;
  await this.save();
};

export const CallModel = model<ICallDocument>('Call', callSchema);
