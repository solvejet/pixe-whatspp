// src/types/mongoose.ts
import type { Document, Types } from 'mongoose';

/**
 * Base interface for documents with timestamps
 */
export interface WithTimestamps {
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Type helper for lean documents
 */
export type LeanDocument<T> = {
  [P in keyof T]: T[P] extends Document
    ? LeanDocument<T[P]>
    : T[P] extends Types.ObjectId
      ? Types.ObjectId
      : T[P] extends Date
        ? Date
        : T[P];
} & {
  _id: Types.ObjectId;
} & WithTimestamps;

export type MongooseDocumentArray<T> = LeanDocument<T>[];
