// src/controllers/auth.controller.ts
import type { Response } from 'express';
import { AuthService } from '@/services/auth.service.js';
import { asyncHandler } from '@/middleware/error-handler.js';
import type {
  TypedAuthRequest,
  LoginRequestBody,
  RegisterRequestBody,
  ILoginResponse,
} from '@/types/auth.js';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  register = asyncHandler(
    async (req: TypedAuthRequest<RegisterRequestBody>, res: Response<ILoginResponse>) => {
      const result = await this.authService.register(req.body, req.user);
      res.status(201).json(result);
    },
  );

  login = asyncHandler(
    async (req: TypedAuthRequest<LoginRequestBody>, res: Response<ILoginResponse>) => {
      const { email, password } = req.body;
      const result = await this.authService.login(email, password);
      res.json(result);
    },
  );

  refreshToken = asyncHandler(
    async (req: TypedAuthRequest<{ refreshToken: string }>, res: Response<ILoginResponse>) => {
      const { refreshToken } = req.body;
      const result = await this.authService.refreshToken(refreshToken);
      res.json(result);
    },
  );

  logout = asyncHandler(
    async (req: TypedAuthRequest<{ refreshToken: string }>, res: Response<{ message: string }>) => {
      const { refreshToken } = req.body;
      await this.authService.logout(refreshToken);
      res.json({ message: 'Successfully logged out' });
    },
  );
}
