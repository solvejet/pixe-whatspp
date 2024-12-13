// src/controllers/auth.controller.ts
import type { Request, Response } from 'express';
import { AuthService } from '@/services/auth.service.js';
import { asyncHandler } from '@/middleware/error-handler.js';
import type {
  AuthenticatedRequest,
  IRegisterRequest,
  ILoginResponse,
  RequestParams,
  RequestQuery,
} from '@/types/auth.js';

// Define specific response types
type LoginRequestBody = {
  email: string;
  password: string;
};

type RefreshTokenRequestBody = {
  refreshToken: string;
};

type LogoutResponseBody = {
  message: string;
};

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  register = asyncHandler(
    async (
      req: AuthenticatedRequest<RequestParams, ILoginResponse, IRegisterRequest, RequestQuery>,
      res: Response<ILoginResponse>,
    ) => {
      const result = await this.authService.register(req.body, req.user);
      res.status(201).json(result);
    },
  );

  login = asyncHandler(
    async (
      req: Request<RequestParams, ILoginResponse, LoginRequestBody, RequestQuery>,
      res: Response<ILoginResponse>,
    ) => {
      const { email, password } = req.body;
      const result = await this.authService.login(email, password);
      res.json(result);
    },
  );

  refreshToken = asyncHandler(
    async (
      req: Request<RequestParams, ILoginResponse, RefreshTokenRequestBody, RequestQuery>,
      res: Response<ILoginResponse>,
    ) => {
      const { refreshToken } = req.body;
      const result = await this.authService.refreshToken(refreshToken);
      res.json(result);
    },
  );

  logout = asyncHandler(
    async (
      req: AuthenticatedRequest<
        RequestParams,
        LogoutResponseBody,
        RefreshTokenRequestBody,
        RequestQuery
      >,
      res: Response<LogoutResponseBody>,
    ) => {
      const { refreshToken } = req.body;
      await this.authService.logout(refreshToken);
      res.json({ message: 'Successfully logged out' });
    },
  );
}
