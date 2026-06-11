import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getApiHealth() {
    return {
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }

  async getDatabaseHealth() {
    const record = await this.prisma.healthCheck.create({
      data: {
        message: 'Database connection ok',
      },
    });

    return {
      status: 'ok',
      database: 'connected',
      testRecordId: record.id,
      createdAt: record.createdAt,
    };
  }
}
