import { Module } from '@nestjs/common';
import { ZohoModule } from '../zoho/zoho.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { KhipuModule } from '../khipu/khipu.module';

@Module({
  imports: [ZohoModule, KhipuModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
