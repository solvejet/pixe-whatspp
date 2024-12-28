// src/models/notification.model.ts
import { Schema, model, type Types } from 'mongoose';

interface INotification {
  userId: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high';
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: Schema.Types.Mixed,
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal',
  },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const NotificationModel = model<INotification>('Notification', notificationSchema);
