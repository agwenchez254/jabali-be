/**
 * Blog posts are stored as a rich-text document (the editor's JSON tree), not HTML, so the storefront can draw
 * them without injecting markup. `sanitizeDoc` keeps only the node and mark types the editor offers and checks
 * every attribute, so a hand-crafted request cannot smuggle anything else in.
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

const MAX_DEPTH = 12;
const MAX_NODES = 5000;
const ALIGN = ['left', 'center', 'right'];

const BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'image', 'hardBreak']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** http(s) URLs and site-relative paths only. No javascript:, data: or protocol-relative URLs. */
export function safeUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 2000) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      new URL(s);
      return s;
    } catch {
      return null;
    }
  }
  return s.startsWith('/') && !s.startsWith('//') ? s : null;
}

function cleanAttrs(type: string, attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const a = attrs ?? {};
  if (type === 'heading') {
    const level = typeof a.level === 'number' && a.level >= 1 && a.level <= 4 ? Math.trunc(a.level) : 2;
    return { level, ...(ALIGN.includes(a.textAlign as string) && { textAlign: a.textAlign }) };
  }
  if (type === 'paragraph') return ALIGN.includes(a.textAlign as string) ? { textAlign: a.textAlign } : undefined;
  if (type === 'orderedList') return { start: typeof a.start === 'number' && a.start >= 1 && a.start < 10_000 ? Math.trunc(a.start) : 1 };
  if (type === 'image') {
    const src = safeUrl(a.src);
    if (!src) return undefined;
    return { src, alt: str(a.alt, 300) ?? '', ...(str(a.title, 300) && { title: str(a.title, 300) }) };
  }
  return undefined;
}

/** Returns a cleaned copy of the document, or throws a string message describing what is wrong with it. */
export function sanitizeDoc(input: unknown): DocNode {
  let count = 0;

  const walk = (n: unknown, depth: number): DocNode | null => {
    if (typeof n !== 'object' || n === null || depth > MAX_DEPTH) return null;
    if (++count > MAX_NODES) throw 'The post is too long.';
    const node = n as DocNode;
    if (node.type === 'text') {
      const text = str(node.text, 20_000);
      if (!text) return null;
      const marks: NonNullable<DocNode['marks']> = [];
      for (const m of Array.isArray(node.marks) ? node.marks : []) {
        if (!m || !MARKS.has(m.type)) continue;
        if (m.type === 'link') {
          const href = safeUrl(m.attrs?.href);
          if (href) marks.push({ type: 'link', attrs: { href } });
        } else marks.push({ type: m.type });
      }
      return { type: 'text', text, ...(marks.length && { marks }) };
    }
    if (!BLOCKS.has(node.type)) return null;
    if (node.type === 'image') {
      const attrs = cleanAttrs('image', node.attrs);
      return attrs ? { type: 'image', attrs } : null;
    }
    const content = (Array.isArray(node.content) ? node.content : []).map((c) => walk(c, depth + 1)).filter((c): c is DocNode => c !== null);
    const attrs = cleanAttrs(node.type, node.attrs);
    return { type: node.type, ...(attrs && { attrs }), ...(content.length && { content }) };
  };

  const root = input as DocNode;
  if (typeof root !== 'object' || root === null || root.type !== 'doc') throw 'The post body must be a rich-text document.';
  const content = (Array.isArray(root.content) ? root.content : []).map((c) => walk(c, 1)).filter((c): c is DocNode => c !== null);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** Plain text of a document, for excerpts and search. */
export function docText(doc: DocNode): string {
  const parts: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    n.content?.forEach(walk);
    if (['paragraph', 'heading', 'listItem', 'blockquote'].includes(n.type)) parts.push(' ');
  };
  walk(doc);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** The first image in the body, used as the list thumbnail when a post has no cover image. */
export function firstImage(doc: unknown): string | null {
  const walk = (n: unknown): string | null => {
    if (typeof n !== 'object' || n === null) return null;
    const node = n as DocNode;
    if (node.type === 'image') return safeUrl(node.attrs?.src);
    for (const c of Array.isArray(node.content) ? node.content : []) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(doc);
}
