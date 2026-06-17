import { PaymentMode } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID('4', { message: 'El customerId debe ser un UUID válido.' })
  customerId!: string;

  @IsEnum(PaymentMode, {
    message:
      'La modalidad de pago debe ser TOTAL_DEBT, OVERDUE_DEBT o MANUAL_SELECTION.',
  })
  mode!: PaymentMode;

  @IsOptional()
  @IsArray({ message: 'documentIds debe ser un arreglo.' })
  @ArrayNotEmpty({ message: 'Debe seleccionar al menos un documento.' })
  @IsUUID('4', {
    each: true,
    message: 'Cada documentId debe ser un UUID válido.',
  })
  documentIds?: string[];
}
