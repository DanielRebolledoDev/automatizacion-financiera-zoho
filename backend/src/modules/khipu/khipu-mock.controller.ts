import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

@Controller('mock/khipu')
export class KhipuMockController {
  @Get('checkout/:paymentId')
  getMockCheckout(@Param('paymentId', new ParseUUIDPipe()) paymentId: string) {
    return {
      message: 'Checkout mock de Khipu.',
      paymentId,
      note: 'Esta URL simula la página de pago. Más adelante será reemplazada por la URL real entregada por Khipu.',
    };
  }
}
