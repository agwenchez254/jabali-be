import { Controller, Header, HttpStatus, MessageEvent, Req, Res, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { defer, finalize, interval, map, merge, Observable } from 'rxjs';
import { DomainError } from '../common/problem-details.filter';
import { ConnectionCounter } from '../common/rate-limit/rate-limiter';
import { StoreEventsService } from './store-events.service';

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAMS_PER_IP = 5;

@ApiTags('store')
@Controller('store')
export class StoreEventsController {
  private readonly streams = new ConnectionCounter();

  constructor(private readonly events: StoreEventsService) {}

  /**
   * Server-sent events. `invalidate` carries `{ tags }` for the storefront to refetch;
   * `ping` is a heartbeat so proxies keep the connection open. Each IP may hold a few streams at a time.
   */
  @Sse('events')
  @Header('X-Accel-Buffering', 'no')
  stream(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Observable<MessageEvent> {
    // Nest writes SSE headers on the raw Node response, so the headers @fastify/cors put on the Fastify reply never
    // reach the browser. Set them on the raw response too (the stream is public and sends no credentials).
    const origin = req.headers.origin;
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.raw.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
    }
    const release = this.streams.acquire(req.ip ?? 'unknown', MAX_STREAMS_PER_IP);
    if (!release) throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, 'too_many_streams', 'Too many open connections');
    const changes = this.events.events$.pipe(
      map((e): MessageEvent => ({ type: 'invalidate', id: String(e.at), data: { tags: e.tags } })),
    );
    const beat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return defer(() => merge(changes, beat)).pipe(finalize(release));
  }
}
