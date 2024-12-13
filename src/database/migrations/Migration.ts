// src/database/migrations/Migration.ts
import { Schema, model } from 'mongoose';
import type { Document } from 'mongoose';

export interface IMigration extends Document {
  name: string;
  createdAt: Date;
}

const MigrationSchema = new Schema<IMigration>({
  name: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});

export const MigrationModel = model<IMigration>('Migration', MigrationSchema);
