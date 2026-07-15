import { Module } from '@nestjs/common';
import { CUSTOMER_DATA_PROVIDER } from './customer-data.constants';
import { LocalCustomerDataProvider } from './provider/local-customer-data.provider';

@Module({
  providers: [
    LocalCustomerDataProvider,
    {
      provide: CUSTOMER_DATA_PROVIDER,
      useExisting: LocalCustomerDataProvider,
    },
  ],
  exports: [CUSTOMER_DATA_PROVIDER],
})
export class CustomerDataModule {}
