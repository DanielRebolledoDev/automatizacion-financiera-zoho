import { Module } from '@nestjs/common';
import { KhipuMockController } from './khipu-mock.controller';
import { KhipuService } from './khipu.service';

@Module({
  controllers: [KhipuMockController],
  providers: [KhipuService],
  exports: [KhipuService],
})
export class KhipuModule {}
