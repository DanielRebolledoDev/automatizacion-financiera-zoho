import { IntegrationsAdminGuard } from '../integrations/integrations-admin.guard';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller('customers/:customerId/documents')
@UseGuards(IntegrationsAdminGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('pending')
  findPendingByCustomerId(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.documentsService.findPendingByCustomerId(customerId);
  }
}
