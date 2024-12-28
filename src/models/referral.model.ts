// src/models/referral.model.ts
import { Schema, model, type Types } from 'mongoose';

interface IReferral {
  userId: Types.ObjectId;
  sourceUrl?: string;
  sourceId?: string;
  sourceType?: string;
  headline?: string;
  body?: string;
  mediaType?: string;
  campaignId?: string;
  metrics: {
    totalClicks: number;
    uniqueUsers: number;
    conversions: number;
    source: string;
    campaign?: string;
  };
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const referralSchema = new Schema<IReferral>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sourceUrl: String,
  sourceId: String,
  sourceType: String,
  headline: String,
  body: String,
  mediaType: String,
  campaignId: String,
  metrics: {
    totalClicks: { type: Number, default: 0 },
    uniqueUsers: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    source: String,
    campaign: String,
  },
  metadata: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

export const ReferralModel = model<IReferral>('Referral', referralSchema);
