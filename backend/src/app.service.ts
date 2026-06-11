import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      message: 'Api Automatizacion Financiera en Zoho',
      status: 'ok',
    };
  }
}
