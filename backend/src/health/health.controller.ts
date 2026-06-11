import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getApiHealth() {
    return this.healthService.getApiHealth();
  }

  @Get('db')
  getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }
}
