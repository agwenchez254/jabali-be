import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface StoreEvent {
  tags: string[];
  at: number;
}

/** Storefront cache tags affected by an admin entity (the `entity` recorded by AuditInterceptor). */
const ENTITY_TAGS: Record<string, readonly string[]> = {
  content_block: ['Home', 'Content'],
  page: ['Home', 'Content'],
  product: ['Product', 'Home'],
  variant: ['Product', 'Home'],
  colour: ['Product', 'Home'],
  inventory: ['Product', 'Home'],
  order: ['Product', 'Home'],
  media: ['Product', 'Category', 'Home'],
  category: ['Category', 'Home'],
  testimonial: ['Testimonial', 'Home'],
  setting: ['Settings', 'Home'],
  delivery_zone: ['Delivery'],
};

/** Tags for an entity, or an empty list when the storefront does not show it. Always a fresh array. */
export function tagsForEntity(entity: string): string[] {
  return [...(ENTITY_TAGS[entity] ?? [])];
}

/** In-process bus: admin writes publish here, the SSE endpoint fans out to connected storefronts. */
@Injectable()
export class StoreEventsService {
  private readonly subject = new Subject<StoreEvent>();
  readonly events$: Observable<StoreEvent> = this.subject.asObservable();

  emit(tags: string[]): void {
    if (tags.length === 0) return;
    this.subject.next({ tags: [...new Set(tags)], at: Date.now() });
  }

  emitForEntity(entity: string): void {
    this.emit(tagsForEntity(entity));
  }
}
