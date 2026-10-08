import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ScimError, ScimService, SCIM_USER_SCHEMA, scimBaseUrl, type ScimUserInput } from './scim.service';

const SCIM_RATE_LIMIT = { limit: 600, windowSeconds: 60, bucket: 'scim' };

/**
 * SCIM 2.0 endpoints for identity providers. Authenticated by the workspace's
 * SCIM bearer token (not a user session), and answered in SCIM JSON — not the
 * app's { data, error } envelope — so responses are written directly.
 */
@Public()
@RateLimit(SCIM_RATE_LIMIT)
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  serviceProviderConfig(@Res() res: Response) {
    send(res, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        { type: 'oauthbearertoken', name: 'Bearer token', description: 'Workspace SCIM token', primary: true },
      ],
    });
  }

  @Get('ResourceTypes')
  resourceTypes(@Res() res: Response) {
    send(res, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCIM_USER_SCHEMA,
          meta: { resourceType: 'ResourceType', location: `${scimBaseUrl()}/ResourceTypes/User` },
        },
      ],
    });
  }

  @Get('Users')
  list(
    @Headers('authorization') auth: string | undefined,
    @Query('filter') filter: string | undefined,
    @Query('startIndex') startIndex: string | undefined,
    @Query('count') count: string | undefined,
    @Res() res: Response,
  ) {
    return this.run(res, auth, 200, (ws) => this.scim.listUsers(ws, filter, startIndex, count));
  }

  @Get('Users/:id')
  get(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Res() res: Response) {
    return this.run(res, auth, 200, (ws) => this.scim.getUser(ws, id));
  }

  @Post('Users')
  create(@Headers('authorization') auth: string | undefined, @Body() body: unknown, @Res() res: Response) {
    return this.run(res, auth, 201, (ws) => this.scim.createUser(ws, asObject(body)));
  }

  @Put('Users/:id')
  replace(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    return this.run(res, auth, 200, (ws) => this.scim.replaceUser(ws, id, asObject(body)));
  }

  @Patch('Users/:id')
  patch(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    return this.run(res, auth, 200, (ws) => this.scim.patchUser(ws, id, body));
  }

  @Delete('Users/:id')
  remove(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Res() res: Response) {
    return this.run(res, auth, 204, async (ws) => {
      await this.scim.deleteUser(ws, id);
      return undefined;
    });
  }

  private async run(
    res: Response,
    auth: string | undefined,
    status: number,
    fn: (workspaceId: string) => Promise<unknown>,
  ) {
    try {
      const workspaceId = await this.scim.authenticate(auth);
      const body = await fn(workspaceId);
      if (status === 204) return res.status(204).end();
      send(res, status, body);
    } catch (err) {
      if (err instanceof ScimError) return send(res, err.status, err.body());
      throw err; // unexpected — the global filter reports it
    }
  }
}

function send(res: Response, status: number, body: unknown) {
  res.status(status).type('application/scim+json').send(JSON.stringify(body));
}

function asObject(body: unknown): ScimUserInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ScimError(400, 'Expected a JSON object', 'invalidSyntax');
  }
  return body as ScimUserInput;
}
