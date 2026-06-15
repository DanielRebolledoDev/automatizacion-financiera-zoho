import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidRut, normalizeRut } from '../../common/utils/rut.util';
import { ExpressSearchCustomerDto } from './dto/express-search-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async expressSearch(expressSearchCustomerDto: ExpressSearchCustomerDto) {
    const normalizedRut = normalizeRut(expressSearchCustomerDto.rut);

    if (!isValidRut(normalizedRut)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: {
        rutNormalized: normalizedRut,
      },
      select: {
        id: true,
        rut: true,
        rutNormalized: true,
        businessName: true,
        email: true,
        phone: true,
        zohoCustomerId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(
        'No se encontró un cliente asociado al RUT ingresado.',
      );
    }

    return {
      message: 'Cliente encontrado correctamente.',
      customer,
    };
  }
}
