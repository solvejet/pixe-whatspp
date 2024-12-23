// src/types/jwt.ts
import type { JwtPayload } from 'jsonwebtoken';

export interface JWTTokens {
  accessToken: string;
  refreshToken: string;
}

export interface DecodedToken extends JwtPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  tokenVersion?: number;
}

export interface TokenMetadata {
  ipAddress: string;
  userAgent: string;
  deviceId?: string;
}

export interface TokenConfig {
  secret: string;
  expiresIn: string;
  issuer: string;
  audience: string;
}
