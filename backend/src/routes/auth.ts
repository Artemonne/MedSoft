import { Router } from 'express';
import { authController } from '../controllers/auth.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAccessToken } from '../middleware/authenticate.js';
import { requireCsrfProtection } from '../middleware/csrf-protection.js';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(authController.login));
authRouter.post('/refresh', requireCsrfProtection, asyncHandler(authController.refresh));
authRouter.post('/logout', requireCsrfProtection, asyncHandler(authController.logout));
authRouter.get('/me', asyncHandler(authenticateAccessToken), asyncHandler(authController.me));
