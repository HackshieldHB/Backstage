import { Global, Module } from '@nestjs/common';
import { AppRegistry } from './app-registry';
import { CommandsController } from './commands.controller';

/**
 * Kept in its own file rather than alongside AppRegistry: the module wires in
 * CommandsController, which itself depends on AppRegistry, so co-locating the
 * @Module with the class would make app-registry.ts and commands.controller.ts
 * import each other.
 */
@Global()
@Module({
  controllers: [CommandsController],
  providers: [AppRegistry],
  exports: [AppRegistry],
})
export class IntegrationsModule {}
