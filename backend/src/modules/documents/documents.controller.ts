import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller('customers/:customerId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('pending')
  findPendingByCustomerId(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ) {
    return this.documentsService.findPendingByCustomerId(customerId);
  }
}
