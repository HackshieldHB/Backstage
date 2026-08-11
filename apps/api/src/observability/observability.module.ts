import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ErrorReporter, createErrorReporter } from './error-reporter';
import { RequestContextMiddleware } from './request-context';
import { ClientErrorsController } from './client-errors.controller';

@Global()
@Module({
  controllers: [ClientErrorsController],
  providers: [{ provide: ErrorReporter, useFactory: createErrorReporter }],
  exports: [ErrorReporter],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // First in the chain: everything downstream should run inside a context.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
