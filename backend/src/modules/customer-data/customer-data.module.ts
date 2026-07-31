import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZohoModule } from '../zoho/zoho.module';
import { CUSTOMER_DATA_PROVIDER } from './customer-data.constants';
import { LocalCustomerDataProvider } from './provider/local-customer-data.provider';
import { ZohoCustomerDataProvider } from './provider/zoho-customer-data.provider';

@Module({
  imports: [ZohoModule],
  providers: [
    LocalCustomerDataProvider,
    ZohoCustomerDataProvider,
    {
      provide: CUSTOMER_DATA_PROVIDER,
      inject: [
        ConfigService,
        LocalCustomerDataProvider,
        ZohoCustomerDataProvider,
      ],
      useFactory: (
        configService: ConfigService,
        localProvider: LocalCustomerDataProvider,
        zohoProvider: ZohoCustomerDataProvider,
      ) => {
        const dataSource =
          configService.get<string>('CUSTOMER_DATA_SOURCE') ?? 'local';

        return dataSource === 'zoho' ? zohoProvider : localProvider;
      },
    },
  ],
  exports: [CUSTOMER_DATA_PROVIDER],
})
export class CustomerDataModule {}
