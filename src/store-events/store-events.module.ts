import { Global, Module } from '@nestjs/common';
import { StoreEventsController } from './store-events.controller';
import { StoreEventsService } from './store-events.service';

@Global()
@Module({
  controllers: [StoreEventsController],
  providers: [StoreEventsService],
  exports: [StoreEventsService],
})
export class StoreEventsModule {}
