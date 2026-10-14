import { Controller, Header, MessageEvent, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import { StoreEventsService } from './store-events.service';

export const HEARTBEAT_MS = 25_000;

@ApiTags('store')
@Controller('store')
export class StoreEventsController {
  constructor(private readonly events: StoreEventsService) {}

  /**
   * Server-sent events. `invalidate` carries `{ tags }` for the storefront to refetch;
   * `ping` is a heartbeat so proxies keep the connection open.
   */
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  stream(): Observable<MessageEvent> {
    const changes = this.events.events$.pipe(
      map((e): MessageEvent => ({ type: 'invalidate', id: String(e.at), data: { tags: e.tags } })),
    );
    const beat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(changes, beat);
  }
}
