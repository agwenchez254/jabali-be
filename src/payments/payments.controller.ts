import { Body, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { PaymentsService } from './payments.service';
import { stkCallbackSchema } from './providers/mpesa-daraja.provider';

export class StkPushDto {
  @IsString() @MinLength(5) @MaxLength(20) orderNumber: string;
  /** Phone that receives the M-Pesa prompt. Must be the customer's phone on the order. */
  @IsString() @MaxLength(20) phone: string;
}

@ApiTags('store')
@Controller('store/payments/mpesa')
export class StorePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** (Re)sends the M-Pesa STK push for a pending order, e.g. after the customer dismissed the prompt. */
  @Post('stk-push')
  @HttpCode(200)
  stkPush(@Body() dto: StkPushDto) {
    return this.payments.initiateForCustomer(dto.orderNumber, dto.phone);
  }
}

/**
 * Safaricom posts the STK result here. Daraja callbacks are unsigned, so the URL carries a secret path
 * segment (MPESA_CALLBACK_SECRET); set MPESA_CALLBACK_URL to `<public-api>/api/v1/webhooks/mpesa/<secret>`.
 * Also restrict by Safaricom's published IP ranges at the proxy in production.
 */
@ApiExcludeController()
@Controller('webhooks/mpesa')
export class MpesaWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':secret')
  @HttpCode(200)
  async callback(@Param('secret') secret: string, @Body() body: unknown) {
    const expected = this.payments.webhookSecret;
    if (!expected) throw new NotFoundException();
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException();

    const parsed = stkCallbackSchema.safeParse(body);
    if (parsed.success) await this.payments.handleStkCallback(parsed.data.Body.stkCallback, body);
    // always acknowledge so Safaricom does not keep retrying
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}

@AdminController('payments', 'payment')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Queries Daraja for the real outcome of a pending M-Pesa payment (missed callback recovery). */
  @Post(':orderId/reconcile') @HttpCode(200) @RequirePermissions('order:write')
  reconcile(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.payments.reconcile(orderId);
  }
}
