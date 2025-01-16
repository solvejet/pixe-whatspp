// src/config/socket.ts

import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { RedisAdapter } from './redis-adapter.js';
import { Role } from '@/types/auth.js';
import { jwtService } from '@/services/jwt.service.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import type { MessageType } from '@/types/whatsapp.chat.js';
import type { MessageContent } from '@/models/chat.model.js';

/**
 * Type definitions for Socket.IO events and data structures
 */

// WhatsApp related event types
export interface WhatsAppMessageEvent {
  messageId: string;
  recipientId: string;
  type: MessageType;
  content: {
    _id: string;
    customerId: string;
    adminId: string;
    whatsappMessageId: string;
    type: MessageType;
    content: MessageContent;
    metadata?: Map<string, unknown> | undefined;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    direction: 'inbound' | 'outbound';
    timestamp: Date;
    conversationId?: string | undefined;
    templateId?: string | undefined;
    useTemplate: boolean;
    windowExpiresAt?: Date | undefined;
    referral?:
      | {
          source_url: string;
          source_id: string;
          source_type: 'ad' | 'post';
          headline?: string;
          body?: string;
          media_type?: string;
          image_url?: string;
          video_url?: string;
          thumbnail_url?: string;
          ctwa_clid: string;
        }
      | undefined;
  };
  timestamp: number;
  context?:
    | {
        from: string;
        id: string;
        forwarded?: boolean;
        referred_product?: {
          catalog_id: string;
          product_retailer_id: string;
        };
      }
    | undefined;
  referral?:
    | {
        source_url: string;
        source_id: string;
        source_type: 'ad' | 'post';
        headline?: string;
        body?: string;
        media_type?: string;
        image_url?: string;
        video_url?: string;
        thumbnail_url?: string;
        ctwa_clid: string;
      }
    | undefined;
  reaction?:
    | {
        message_id: string;
        emoji: string;
      }
    | undefined;
}

export interface WhatsAppStatusEvent {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  recipientId: string;
  conversation: {
    id: string;
    origin?: {
      type: string;
    };
    expiration_timestamp?: string;
  } | null;
  pricing: {
    billable: boolean;
    pricing_model: string;
    category: string;
  } | null;
  error: {
    code: string;
    message: string;
    error_data?: {
      details: string;
    };
  } | null;
}

export interface WhatsAppIncomingEvent {
  type: 'new_message' | 'reaction' | 'message_status';
  message: MessageContent;
  status?: string;
  conversation?: {
    id: string;
    origin?: {
      type: string;
    };
    expiration_timestamp?: string;
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
}

// Error event interface
interface ErrorEvent {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Socket.IO event interfaces
interface ServerToClientEvents {
  whatsapp_message: (data: WhatsAppMessageEvent) => void;
  whatsapp_status: (data: WhatsAppStatusEvent) => void;
  whatsapp_incoming: (data: WhatsAppIncomingEvent) => void;
  error: (data: ErrorEvent) => void;
}

interface ClientToServerEvents {
  join_channel: (channelId: string, callback: (error?: ErrorEvent) => void) => void;
  leave_channel: (channelId: string, callback: (error?: ErrorEvent) => void) => void;
}

interface InterServerEvents {
  ping: () => void;
}

interface SocketData {
  userId: string;
  roles: Role[];
  username?: string;
}

// Extended interfaces for authentication
interface SocketAuthData {
  userId: string;
  roles: Role[];
  username?: string;
}

interface ExtendedIncomingMessage extends IncomingMessage {
  socketData?: SocketAuthData;
}

// Custom socket type with proper generics
type CustomSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Socket.IO server instance with proper type definitions
 */
export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>();

/**
 * Authenticate socket connection using JWT
 * @param token - JWT token from client
 * @returns Socket authentication data
 * @throws AppError if authentication fails
 */
const authenticateSocket = async (token: string): Promise<SocketAuthData> => {
  try {
    const decoded = await jwtService.verifyToken(token);
    const roles = decoded.roles.map((role) => {
      if (Object.values(Role).includes(role as Role)) {
        return role as Role;
      }
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid role type', 400);
    });

    return {
      userId: decoded.userId,
      roles,
      username: decoded.email,
    };
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid or expired token', 401);
  }
};

/**
 * Handle joining a WhatsApp channel
 * @param socket - Socket instance
 * @param channelId - Channel to join
 * @param callback - Callback function to handle result
 */
const handleJoinChannel = async (
  socket: CustomSocket,
  channelId: string,
  callback: (error?: ErrorEvent) => void,
): Promise<void> => {
  try {
    if (!channelId?.trim()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid channel ID', 400);
    }

    // Join the channel with proper naming convention
    const channel = `whatsapp:${channelId}`;
    await socket.join(channel);

    logger.debug('Client joined WhatsApp channel:', {
      channelId,
      socketId: socket.id,
      userId: socket.data.userId,
    });

    callback();
  } catch (error) {
    const errorEvent: ErrorEvent = {
      code: error instanceof AppError ? error.code.toString() : 'JOIN_ERROR',
      message: error instanceof Error ? error.message : 'Failed to join channel',
    };

    logger.error('Error joining channel:', {
      error,
      channelId,
      socketId: socket.id,
      userId: socket.data.userId,
    });

    callback(errorEvent);
  }
};

/**
 * Handle leaving a WhatsApp channel
 * @param socket - Socket instance
 * @param channelId - Channel to leave
 * @param callback - Callback function to handle result
 */
const handleLeaveChannel = async (
  socket: CustomSocket,
  channelId: string,
  callback: (error?: ErrorEvent) => void,
): Promise<void> => {
  try {
    if (!channelId?.trim()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid channel ID', 400);
    }

    // Leave the channel with proper naming convention
    const channel = `whatsapp:${channelId}`;
    await socket.leave(channel);

    logger.debug('Client left WhatsApp channel:', {
      channelId,
      socketId: socket.id,
      userId: socket.data.userId,
    });

    callback();
  } catch (error) {
    const errorEvent: ErrorEvent = {
      code: error instanceof AppError ? error.code.toString() : 'LEAVE_ERROR',
      message: error instanceof Error ? error.message : 'Failed to leave channel',
    };

    logger.error('Error leaving channel:', {
      error,
      channelId,
      socketId: socket.id,
      userId: socket.data.userId,
    });

    callback(errorEvent);
  }
};

/**
 * Initialize Socket.IO server with Redis adapter and authentication
 * @param httpServer - HTTP server instance
 */
export const initializeSocket = async (httpServer: HttpServer): Promise<void> => {
  try {
    // Initialize Redis adapter
    const redisAdapter = await RedisAdapter.createAdapter();
    io.adapter(redisAdapter);

    // Configure Socket.IO server
    io.attach(httpServer, {
      path: env.SOCKET_PATH,
      pingTimeout: env.SOCKET_PING_TIMEOUT,
      pingInterval: env.SOCKET_PING_INTERVAL,
      upgradeTimeout: env.SOCKET_UPGRADE_TIMEOUT,
      maxHttpBufferSize: env.SOCKET_MAX_HTTP_BUFFER_SIZE,
      cors: {
        origin: env.SOCKET_CORS_ORIGIN,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      allowRequest: async (req: ExtendedIncomingMessage, callback) => {
        try {
          const token = req.headers.authorization?.split(' ')[1];
          if (!token) {
            callback(null, false);
            return;
          }

          const socketData = await authenticateSocket(token);
          req.socketData = socketData;
          callback(null, true);
        } catch (error) {
          logger.error('Socket authentication failed:', error);
          callback(null, false);
        }
      },
    });

    // Authentication middleware
    io.use(async (socket: CustomSocket, next: (err?: Error) => void) => {
      try {
        // Wait for request access
        const request = await Promise.resolve(socket.request as ExtendedIncomingMessage);

        // Verify socket data exists
        if (!request.socketData) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 'Socket authentication data not found', 401);
        }

        // Wait for data assignment
        socket.data = await Promise.resolve(request.socketData);

        // Move to next middleware
        await Promise.resolve(next());
      } catch (error) {
        // Log and handle error
        await logger.error('Socket middleware error:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Handle socket connections
    io.on('connection', (socket: CustomSocket) => {
      // Join user-specific room
      void socket.join(`user:${socket.data.userId}`);

      logger.info('Client connected:', {
        id: socket.id,
        userId: socket.data.userId,
        username: socket.data.username,
        roles: socket.data.roles,
      });

      // Event handlers
      socket.on('join_channel', (channelId, callback) => {
        void handleJoinChannel(socket, channelId, callback);
      });

      socket.on('leave_channel', (channelId, callback) => {
        void handleLeaveChannel(socket, channelId, callback);
      });

      // Disconnection handler
      socket.on('disconnect', (reason) => {
        logger.info('Client disconnected:', {
          id: socket.id,
          userId: socket.data.userId,
          reason,
        });
      });

      // Error handler
      socket.on('error', (err: Error) => {
        logger.error('Socket error:', {
          id: socket.id,
          userId: socket.data.userId,
          error: err.message,
          stack: err.stack,
        });

        socket.emit('error', {
          code: 'SOCKET_ERROR',
          message: 'An internal error occurred',
          details: {
            socketId: socket.id,
            timestamp: new Date().toISOString(),
          },
        });
      });
    });

    logger.info('Socket.IO server initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Socket.IO server:', error);
    throw new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'Failed to initialize Socket.IO server',
      500,
      false,
      {
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      },
    );
  }
};
