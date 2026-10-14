export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
