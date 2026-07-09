import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { data: { status: 'ok' }, error: null };
  }
}
