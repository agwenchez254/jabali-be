import { firstValueFrom } from 'rxjs';
import { StoreEventsService, tagsForEntity } from './store-events.service';

describe('tagsForEntity', () => {
  it('maps admin entities to storefront tags', () => {
    expect(tagsForEntity('content_block')).toEqual(['Home', 'Content']);
    expect(tagsForEntity('product')).toEqual(['Product', 'Home']);
    expect(tagsForEntity('delivery_zone')).toEqual(['Delivery']);
  });

  it('returns nothing for entities the storefront does not show', () => {
    expect(tagsForEntity('promotion')).toEqual([]);
    expect(tagsForEntity('staff')).toEqual([]);
    expect(tagsForEntity('')).toEqual([]);
  });

  it('returns a copy so callers cannot mutate the table', () => {
    const tags = tagsForEntity('product');
    tags.push('Nope');
    expect(tagsForEntity('product')).toEqual(['Product', 'Home']);
  });
});

describe('StoreEventsService', () => {
  it('delivers emitted tags to subscribers', async () => {
    const svc = new StoreEventsService();
    const next = firstValueFrom(svc.events$);
    svc.emitForEntity('testimonial');
    const event = await next;
    expect(event.tags).toEqual(['Testimonial', 'Home']);
    expect(typeof event.at).toBe('number');
  });

  it('emits nothing for unknown entities or empty tag lists', () => {
    const svc = new StoreEventsService();
    const seen: unknown[] = [];
    svc.events$.subscribe((e) => seen.push(e));
    svc.emitForEntity('promotion');
    svc.emit([]);
    expect(seen).toEqual([]);
  });

  it('removes duplicate tags', async () => {
    const svc = new StoreEventsService();
    const next = firstValueFrom(svc.events$);
    svc.emit(['Home', 'Product', 'Home']);
    expect((await next).tags).toEqual(['Home', 'Product']);
  });
});
