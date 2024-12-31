// src/services/socket.service.ts

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { RedisAdapter } from '@/config/redis-adapter.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { jwtService } from '@/services/jwt.service.js';
import type { AuthUser } from '@/types/auth.js';
import { Role } from '@/types/auth.js'; // Import Role enum
import { whatsappService } from './whatsapp.service.js';

interface AuthenticatedSocket extends Socket {
  user?: AuthUser;
}

export class SocketService {
  private static instance: SocketService;
  private io: SocketServer | null = null;
  private readonly SOCKET_ROOM_PREFIX = 'conversation:'; // Changed from chat: to conversation:

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public async initialize(server: HttpServer): Promise<SocketServer> {
    try {
      const adapter = await RedisAdapter.createAdapter();

      this.io = new SocketServer(server, {
        adapter,
        cors: {
          origin: env.SOCKET_CORS_ORIGIN,
          methods: ['GET', 'POST'],
          credentials: true,
        },
        path: env.SOCKET_PATH,
        pingTimeout: env.SOCKET_PING_TIMEOUT,
        pingInterval: env.SOCKET_PING_INTERVAL,
        upgradeTimeout: env.SOCKET_UPGRADE_TIMEOUT,
        maxHttpBufferSize: env.SOCKET_MAX_HTTP_BUFFER_SIZE,
        transports: ['websocket', 'polling'],
      });

      this.io.use(this.authMiddleware.bind(this));
      this.io.on('connection', this.handleConnection.bind(this));
      whatsappService.setSocketServer(this.io);

      return this.io;
    } catch (error) {
      logger.error('Failed to initialize socket service:', error);
      throw error;
    }
  }

  private async authMiddleware(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      const token =
        socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = await jwtService.verifyToken(token);
      socket.user = {
        _id: decoded.userId, // Add the _id field
        userId: decoded.userId,
        email: decoded.email,
        roles: decoded.roles as Role[],
        permissions: decoded.permissions,
      };

      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Authentication failed'));
    }
  }

  private async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      if (!socket.user) {
        socket.disconnect(true);
        return;
      }

      // Join user's personal room for direct messages
      socket.join(`user:${socket.user.userId}`);

      // Setup event handlers
      this.setupEventHandlers(socket);

      logger.info(`User ${socket.user.userId} connected to socket`);
    } catch (error) {
      logger.error('Error handling socket connection:', error);
      socket.disconnect(true);
    }
  }

  private setupEventHandlers(socket: AuthenticatedSocket): void {
    // Join conversation room
    socket.on('join_conversation', async (conversationId: string) => {
      try {
        socket.join(`${this.SOCKET_ROOM_PREFIX}${conversationId}`);
        socket.emit('conversation_joined', { conversationId });
      } catch (error) {
        logger.error('Error joining conversation:', error);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', async (conversationId: string) => {
      try {
        socket.leave(`${this.SOCKET_ROOM_PREFIX}${conversationId}`);
        socket.emit('conversation_left', { conversationId });
      } catch (error) {
        logger.error('Error leaving conversation:', error);
        socket.emit('error', { message: 'Failed to leave conversation' });
      }
    });

    // Mark messages as read
    socket.on('mark_read', async (data: { conversationId: string; messageIds: string[] }) => {
      try {
        await whatsappService.markMessagesAsRead(data.conversationId, data.messageIds);
        socket.to(`${this.SOCKET_ROOM_PREFIX}${data.conversationId}`).emit('messages_read', {
          userId: socket.user?.userId,
          conversationId: data.conversationId,
          messageIds: data.messageIds,
        });
      } catch (error) {
        logger.error('Error marking messages as read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.info(`User ${socket.user?.userId} disconnected from socket`);
    });
  }

  // Utility methods for external use
  public emitToUser(userId: string, event: string, data: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, data);
  }

  public emitToConversation(conversationId: string, event: string, data: unknown): void {
    this.io?.to(`${this.SOCKET_ROOM_PREFIX}${conversationId}`).emit(event, data);
  }

  public broadcastToUsers(userIds: string[], event: string, data: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, data);
    }
  }
}

export const socketService = SocketService.getInstance();
