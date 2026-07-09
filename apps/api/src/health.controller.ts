import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
