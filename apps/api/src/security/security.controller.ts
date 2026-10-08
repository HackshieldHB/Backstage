import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AddDomainSchema,
  CreateApiTokenSchema,
  CreateBotSchema,
  RetentionSettingsSchema,
  SsoConnectionSchema,
  WORKSPACE_EXPORT_SCOPES,
  type AddDomainInput,
  type CreateApiTokenInput,
  type CreateBotInput,
  type RetentionSettingsInput,
  type SsoConnectionInput,
  type WorkspaceExportScope,
} from '@backstages/shared';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { HumanOnly } from '../common/human-only.decorator';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApiTokensService } from './api-tokens.service';
import { DataGovernanceService } from './data-governance.service';
import { DomainsService } from './domains.service';
import { ScimService } from './scim.service';
import { SsoLoginError, SsoService } from './sso.service';

/**
 * Account & workspace security. Everything that mints credentials, changes
 * sign-in rules or moves data out of the workspace is @HumanOnly — an API token
 * can never call it, so a leaked token can't escalate or exfiltrate in bulk.
 */
@Controller()
export class SecurityController {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly governance: DataGovernanceService,
    private readonly domains: DomainsService,
    private readonly scim: ScimService,
    private readonly sso: SsoService,
  ) {}

  // ---------- personal API tokens ----------

  @HumanOnly()
  @Get('me/api-tokens')
  listTokens(@CurrentUser() user: AuthUser) {
    return this.tokens.listMine(user.id);
  }

  @HumanOnly()
  @Post('me/api-tokens')
  createToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateApiTokenSchema)) body: CreateApiTokenInput,
  ) {
    return this.tokens.createMine(user.id, body);
  }

  @HumanOnly()
  @Delete('me/api-tokens/:id')
  revokeToken(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tokens.revokeMine(user.id, id);
  }

  // ---------- bots ----------

  @HumanOnly()
  @Get('workspaces/:id/bots')
  listBots(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.tokens.listBots(user.id, workspaceId);
  }

  @HumanOnly()
  @Post('workspaces/:id/bots')
  createBot(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(CreateBotSchema)) body: CreateBotInput,
  ) {
    return this.tokens.createBot(user.id, workspaceId, body.name, body.scope);
  }

  @HumanOnly()
  @Delete('bots/:id')
  deleteBot(@CurrentUser() user: AuthUser, @Param('id') botId: string) {
    return this.tokens.deleteBot(user.id, botId);
  }

  @HumanOnly()
  @Post('bots/:id/tokens')
  createBotToken(
    @CurrentUser() user: AuthUser,
    @Param('id') botId: string,
    @Body(new ZodValidationPipe(CreateApiTokenSchema)) body: CreateApiTokenInput,
  ) {
    return this.tokens.createBotToken(user.id, botId, body);
  }

  @HumanOnly()
  @Delete('bots/:id/tokens/:tokenId')
  revokeBotToken(@CurrentUser() user: AuthUser, @Param('id') botId: string, @Param('tokenId') tokenId: string) {
    return this.tokens.revokeBotToken(user.id, botId, tokenId);
  }

  // ---------- retention & export ----------

  @Get('workspaces/:id/retention')
  getRetention(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.governance.getRetention(user.id, workspaceId);
  }

  @HumanOnly()
  @Put('workspaces/:id/retention')
  setRetention(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(RetentionSettingsSchema)) body: RetentionSettingsInput,
  ) {
    return this.governance.setRetention(user.id, workspaceId, body);
  }

  @HumanOnly()
  @RateLimit({ limit: 5, windowSeconds: 3600, bucket: 'workspace-export' })
  @Get('workspaces/:id/export')
  exportWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Query('scope') scopeRaw: string | undefined,
  ) {
    const scope: WorkspaceExportScope = (WORKSPACE_EXPORT_SCOPES as readonly string[]).includes(scopeRaw ?? '')
      ? (scopeRaw as WorkspaceExportScope)
      : 'public';
    return this.governance.export(user.id, workspaceId, scope);
  }

  // ---------- verified domains ----------

  @Get('workspaces/:id/domains')
  listDomains(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.domains.list(user.id, workspaceId);
  }

  @HumanOnly()
  @Post('workspaces/:id/domains')
  addDomain(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(AddDomainSchema)) body: AddDomainInput,
  ) {
    return this.domains.add(user.id, workspaceId, body.domain);
  }

  @HumanOnly()
  @RateLimit({ limit: 20, windowSeconds: 60, bucket: 'domain-verify' })
  @HttpCode(200)
  @Post('domains/:id/verify')
  verifyDomain(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.domains.verify(user.id, id);
  }

  @HumanOnly()
  @Delete('domains/:id')
  removeDomain(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.domains.remove(user.id, id);
  }

  // ---------- SCIM token ----------

  @HumanOnly()
  @Get('workspaces/:id/scim')
  scimStatus(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.scim.status(user.id, workspaceId);
  }

  @HumanOnly()
  @HttpCode(200)
  @Post('workspaces/:id/scim/token')
  rotateScimToken(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.scim.rotateToken(user.id, workspaceId);
  }

  @HumanOnly()
  @Delete('workspaces/:id/scim')
  disableScim(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.scim.disable(user.id, workspaceId);
  }

  // ---------- SSO configuration ----------

  @HumanOnly()
  @Get('workspaces/:id/sso')
  getSso(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.sso.getConnection(user.id, workspaceId);
  }

  @HumanOnly()
  @Put('workspaces/:id/sso')
  saveSso(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
    @Body(new ZodValidationPipe(SsoConnectionSchema)) body: SsoConnectionInput,
  ) {
    return this.sso.saveConnection(user.id, workspaceId, body);
  }

  @HumanOnly()
  @Delete('workspaces/:id/sso')
  deleteSso(@CurrentUser() user: AuthUser, @Param('id') workspaceId: string) {
    return this.sso.deleteConnection(user.id, workspaceId);
  }
}

/** The browser-facing SSO sign-in flow (no session yet). */
@Controller('auth/sso')
export class SsoAuthController {
  private readonly logger = new Logger(SsoAuthController.name);

  constructor(private readonly sso: SsoService) {}

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'sso-discover' })
  @Get('discover')
  discover(@Query('email') email: string | undefined) {
    return this.sso.discover(String(email ?? '').trim().toLowerCase());
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'sso-start' })
  @Get('start')
  async start(
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('email') email: string | undefined,
    @Res() res: Response,
  ) {
    try {
      res.redirect(await this.sso.startUrl(String(workspaceId ?? ''), email));
    } catch (err) {
      this.fail(res, err);
    }
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, bucket: 'sso-callback' })
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') idpError: string | undefined,
    @Res() res: Response,
  ) {
    if (idpError || !code) {
      return this.fail(res, new SsoLoginError('denied', `IdP returned ${idpError ?? 'no code'}`));
    }
    try {
      res.redirect(await this.sso.handleCallback(code, String(state ?? '')));
    } catch (err) {
      this.fail(res, err);
    }
  }

  private fail(res: Response, err: unknown) {
    this.sso.logFailure(err);
    const reason = err instanceof SsoLoginError ? err.reason : 'failed';
    res.redirect(`${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/login?error=sso-${reason}`);
  }
}
