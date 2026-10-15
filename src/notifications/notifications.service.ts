import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';

export type OrderNotificationKind = 'order.created' | 'order.status';

/** What a live notification says about an order. Kept small: it is pushed to browsers. */
export interface OrderNotification {
  id: string;
  kind: OrderNotificationKind;
  orderId: string;
  number: string;
  status: string;
  /** The status before a `order.status` change. */
  previousStatus?: string;
  total: number;
  method: 'delivery' | 'pickup';
  paymentMethod: string;
  /** Staff-facing name. Never sent to customer streams. */
  customerName: string;
  customerId: string;
  at: number;
}

export type OrderNotificationInput = Omit<OrderNotification, 'id' | 'at'>;

/** In-process bus for order events. Staff streams get everything; a customer stream only its own orders. */
@Injectable()
export class NotificationsService {
  private readonly subject = new Subject<OrderNotification>();
  readonly events$: Observable<OrderNotification> = this.subject.asObservable();

  publish(n: OrderNotificationInput): void {
    this.subject.next({ ...n, id: randomUUID(), at: Date.now() });
  }
}

/** The part of a notification a customer may see: no staff-facing fields. */
export function forCustomer(n: OrderNotification) {
  return {
    id: n.id,
    kind: n.kind,
    number: n.number,
    status: n.status,
    previousStatus: n.previousStatus,
    total: n.total,
    method: n.method,
    paymentMethod: n.paymentMethod,
    at: n.at,
  };
}
