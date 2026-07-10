import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ForgotPasswordInput,
  ForgotPasswordSchema,
  LoginInput,
  LoginSchema,
  LogoutInput,
  LogoutSchema,
  RefreshInput,
  RefreshSchema,
  ResetPasswordInput,
  ResetPasswordSchema,
  SignupInput,
  SignupSchema,
} from '@backstages/shared';
import { AuthService } from './auth.service';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const AUTH_RATE_LIMIT = { limit: 10, windowSeconds: 60, bucket: 'auth' };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @Post('signup')
  signup(@Body(new ZodValidationPipe(SignupSchema)) body: SignupInput) {
    return this.authService.signup(body);
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput) {
    return this.authService.login(body);
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'refresh' })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput) {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Body(new ZodValidationPipe(LogoutSchema)) body: LogoutInput) {
    await this.authService.logout(body.refreshToken);
    return { ok: true };
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordInput) {
    await this.authService.forgotPassword(body);
    return { ok: true }; // identical response whether or not the email exists
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body(new ZodValidationPipe(ResetPasswordSchema)) body: ResetPasswordInput) {
    await this.authService.resetPassword(body);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.id);
  }
}
