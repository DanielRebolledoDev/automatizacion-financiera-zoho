import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PaymentExpressRutDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : '',
  )
  @IsString({ message: 'El RUT debe ser un texto.' })
  @IsNotEmpty({ message: 'El RUT es obligatorio.' })
  @MaxLength(20, { message: 'El RUT no puede superar los 20 caracteres.' })
  rut!: string;
}
