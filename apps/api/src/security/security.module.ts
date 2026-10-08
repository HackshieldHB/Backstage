import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ApiTokensService } from './api-tokens.service';
import { DataGovernanceService } from './data-governance.service';
import { DomainsService, TxtResolver } from './domains.service';
import { RetentionQueue } from './retention.queue';
import { ScimController } from './scim.controller';
import { ScimJsonMiddleware } from './scim-json.middleware';
import { ScimService } from './scim.service';
import { SecurityController, SsoAuthController } from './security.controller';
import { SsoService } from './sso.service';

/** API tokens & bots, verified domains, SCIM, OIDC SSO, retention and export. */
@Module({
  imports: [AuthModule, AttachmentsModule],
  controllers: [SecurityController, SsoAuthController, ScimController],
  providers: [
    ApiTokensService,
    DataGovernanceService,
    DomainsService,
    TxtResolver,
    RetentionQueue,
    ScimService,
    SsoService,
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ScimJsonMiddleware).forRoutes({ path: 'scim/v2/*', method: RequestMethod.ALL });
  }
}
