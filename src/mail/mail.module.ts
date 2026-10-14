import { Global, Module } from '@nestjs/common';
import { MailService, mailTransportProvider } from './mail.service';

@Global()
@Module({ providers: [mailTransportProvider, MailService], exports: [MailService] })
export class MailModule {}
