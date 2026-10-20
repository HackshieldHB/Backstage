import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  OAuthExchangeInput,
  OAuthExchangeSchema,
  OAuthProviderSchema,
  type OAuthProvider,
} from '@backstages/shared';
import { Public } from '../common/public.decorator';
import { HumanOnly } from '../common/human-only.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SocialLoginError, SocialLoginService } from './social-login.service';

/** Browser-binding cookie for the sign-in round-trip (see SocialLoginService). */
const COOKIE = 'bs_oauth_browser';
const COOKIE_PATH = '/auth/oauth';

const webOrigin = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
const secureCookies = () => (process.env.PUBLIC_API_URL ?? '').startsWith('https://');

function parseProvider(raw: string): OAuthProvider {
  const parsed = OAuthProviderSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Unknown sign-in provider');
  return parsed.data;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

@Controller('auth/oauth')
export class SocialLoginController {
  constructor(private readonly social: SocialLoginService) {}

  /** Which "Continue with …" buttons the web app should show. */
  @Public()
  @Get('providers')
  providers() {
    return this.social.providers();
  }

  /** Top-level navigation from the login/signup page. */
  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'oauth-start' })
  @Get(':provider/start')
  async start(@Param('provider') raw: string, @Query('email') email: string | undefined, @Res() res: Response) {
    try {
      const { url, browserSecret } = await this.social.startLogin(parseProvider(raw), email?.trim().toLowerCase());
      res.cookie(COOKIE, browserSecret, {
        httpOnly: true,
        // Lax is sent on the provider's top-level redirect back to us.
        sameSite: 'lax',
        secure: secureCookies(),
        path: COOKIE_PATH,
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(url);
    } catch (err) {
      this.fail(res, err, 'login');
    }
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'oauth-callback' })
  @Get(':provider/callback')
  async callback(
    @Param('provider') raw: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const browserSecret = readCookie(req, COOKIE);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    if (providerError || !code) {
      const mode = (await this.social.abandon(state).catch(() => null)) ?? 'login';
      return this.fail(res, new SocialLoginError('denied', `provider returned ${providerError ?? 'no code'}`), mode === 'login' ? 'login' : 'link');
    }
    try {
      const out = await this.social.handleCallback(parseProvider(raw), code, String(state ?? ''), browserSecret);
      res.redirect(out.redirect);
    } catch (err) {
      // Unknown state (expired/forged) → the login page.
      // Link/connect failures are reported inside the app; anything else on the login page.
      this.fail(res, err, err instanceof SocialLoginError && err.mode && err.mode !== 'login' ? 'link' : 'login');
    }
  }

  /** The web app trades the one-time code from /sso#code=… for a session (or a 2FA challenge). */
  @Public()
  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'oauth-exchange' })
  @HttpCode(200)
  @Post('exchange')
  exchange(@Body(new ZodValidationPipe(OAuthExchangeSchema)) body: OAuthExchangeInput) {
    return this.social.exchange(body.code);
  }

  // ---------- connected accounts (signed-in, human sessions only) ----------

  @HumanOnly()
  @Get('identities')
  identities(@CurrentUser() user: AuthUser) {
    return this.social.connected(user.id);
  }

  @HumanOnly()
  @RateLimit({ limit: 10, windowSeconds: 60, bucket: 'oauth-link' })
  @HttpCode(200)
  @Post(':provider/link')
  async link(@CurrentUser() user: AuthUser, @Param('provider') raw: string) {
    try {
      return await this.social.startLink(user.id, parseProvider(raw));
    } catch (err) {
      if (err instanceof SocialLoginError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  @HumanOnly()
  @RateLimit({ limit: 10, windowSeconds: 60, bucket: 'oauth-link' })
  @HttpCode(200)
  @Post('link/confirm')
  confirmLink(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(OAuthExchangeSchema)) body: OAuthExchangeInput) {
    return this.social.confirmLink(user.id, body.code);
  }

  @HumanOnly()
  @Delete('identities/:id')
  unlink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.social.unlink(user.id, id);
  }

  private fail(res: Response, err: unknown, mode: 'login' | 'link') {
    this.social.logFailure(err);
    const reason = err instanceof SocialLoginError ? err.reason : 'failed';
    res.redirect(
      mode === 'link'
        ? `${webOrigin()}/app?oauth-link-error=${encodeURIComponent(reason)}`
        : `${webOrigin()}/login?error=oauth-${encodeURIComponent(reason)}`,
    );
  }
}
