// src/services/socket.service.ts

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { Redis } from '@/config/redis.js';
import { RedisAdapter } from '@/config/redis-adapter.js';
import { env } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { jwtService } from '@/services/jwt.service.js';
import type { AuthUser } from '@/types/auth.js';
import { whatsappService } from './whatsapp.service.js';

interface AuthenticatedSocket extends Socket {
  user?: AuthUser;
}

export class SocketService {
  private static instance: SocketService;
  private io: SocketServer | null = null;
  private readonly SOCKET_ROOM_PREFIX = 'chat:';
  private readonly ONLINE_USERS_KEY = 'online_users';
  private readonly SOCKET_USER_PREFIX = 'socket:user:';

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

      // Set authentication middleware
      this.io.use(this.authMiddleware.bind(this));

      // Setup event handlers
      this.io.on('connection', this.handleConnection.bind(this));

      // Pass socket server to WhatsApp service for real-time updates
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
        userId: decoded.userId,
        email: decoded.email,
        roles: decoded.roles,
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

      const userId = socket.user.userId;

      // Join user's room
      await this.joinUserRooms(socket);

      // Track online status
      await this.trackUserOnlineStatus(userId, true);

      // Setup disconnect handler
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });

      // Setup chat event handlers
      this.setupChatEventHandlers(socket);

      logger.info(`User ${userId} connected`);
    } catch (error) {
      logger.error('Error handling socket connection:', error);
      socket.disconnect(true);
    }
  }

  private async joinUserRooms(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.user) return;

    const userId = socket.user.userId;

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Join active chat rooms
    const activeChats = await this.getActiveChats(userId);
    for (const chatId of activeChats) {
      socket.join(`${this.SOCKET_ROOM_PREFIX}${chatId}`);
    }
  }

  private async getActiveChats(userId: string): Promise<string[]> {
    // Implement logic to fetch active chat IDs for the user
    // This could be from your conversation model or cache
    return [];
  }

  private async trackUserOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    try {
      const multi = Redis.client.multi();

      if (isOnline) {
        multi.sAdd(this.ONLINE_USERS_KEY, userId);
        multi.set(`${this.SOCKET_USER_PREFIX}${userId}`, Date.now().toString());
      } else {
        multi.sRem(this.ONLINE_USERS_KEY, userId);
        multi.del(`${this.SOCKET_USER_PREFIX}${userId}`);
      }

      await multi.exec();

      // Emit online status update to relevant users
      this.io?.emit('user_status_change', { userId, isOnline });
    } catch (error) {
      logger.error('Error tracking user online status:', error);
    }
  }

  private async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    try {
      if (!socket.user) return;

      const userId = socket.user.userId;
      await this.trackUserOnlineStatus(userId, false);
      logger.info(`User ${userId} disconnected`);
    } catch (error) {
      logger.error('Error handling socket disconnect:', error);
    }
  }

  private setupChatEventHandlers(socket: AuthenticatedSocket): void {
    // Join chat room
    socket.on('join_chat', async (chatId: string) => {
      try {
        socket.join(`${this.SOCKET_ROOM_PREFIX}${chatId}`);
        socket.emit('chat_joined', { chatId });
      } catch (error) {
        logger.error('Error joining chat:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Leave chat room
    socket.on('leave_chat', async (chatId: string) => {
      try {
        socket.leave(`${this.SOCKET_ROOM_PREFIX}${chatId}`);
        socket.emit('chat_left', { chatId });
      } catch (error) {
        logger.error('Error leaving chat:', error);
        socket.emit('error', { message: 'Failed to leave chat' });
      }
    });

    // Typing indicator
    socket.on('typing_start', (data: { chatId: string }) => {
      socket.to(`${this.SOCKET_ROOM_PREFIX}${data.chatId}`).emit('user_typing', {
        userId: socket.user?.userId,
        chatId: data.chatId,
      });
    });

    socket.on('typing_end', (data: { chatId: string }) => {
      socket.to(`${this.SOCKET_ROOM_PREFIX}${data.chatId}`).emit('user_stopped_typing', {
        userId: socket.user?.userId,
        chatId: data.chatId,
      });
    });

    // Mark messages as read
    socket.on('mark_read', async (data: { chatId: string; messageIds: string[] }) => {
      try {
        // Implement message read status update logic
        socket.to(`${this.SOCKET_ROOM_PREFIX}${data.chatId}`).emit('messages_read', {
          userId: socket.user?.userId,
          chatId: data.chatId,
          messageIds: data.messageIds,
        });
      } catch (error) {
        logger.error('Error marking messages as read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });
  }

  // Utility methods for external use
  public isUserOnline(userId: string): Promise<boolean> {
    return Redis.client.sIsMember(this.ONLINE_USERS_KEY, userId);
  }

  public emitToUser(userId: string, event: string, data: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, data);
  }

  public emitToChat(chatId: string, event: string, data: unknown): void {
    this.io?.to(`${this.SOCKET_ROOM_PREFIX}${chatId}`).emit(event, data);
  }

  public broadcastToUsers(userIds: string[], event: string, data: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, data);
    }
  }

  public getOnlineUsers(): Promise<string[]> {
    return Redis.client.sMembers(this.ONLINE_USERS_KEY);
  }

  public async getUserLastActive(userId: string): Promise<number | null> {
    const lastActive = await Redis.get(`${this.SOCKET_USER_PREFIX}${userId}`);
    return lastActive ? parseInt(lastActive, 10) : null;
  }
}

export const socketService = SocketService.getInstance();
