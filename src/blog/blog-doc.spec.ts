import { docText, firstImage, safeUrl, sanitizeDoc } from './blog-doc';

describe('safeUrl', () => {
  it('allows http(s) and site paths only', () => {
    expect(safeUrl('https://x.co/a.jpg')).toBe('https://x.co/a.jpg');
    expect(safeUrl('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('//evil.co/x')).toBeNull();
  });
});

describe('sanitizeDoc', () => {
  it('keeps supported content, emoji included', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'New in 🎉' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.co' } }] }] },
        { type: 'image', attrs: { src: 'https://x.co/a.jpg', alt: 'A' } },
      ],
    });
    expect(doc.content?.[0]).toEqual({ type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'New in 🎉' }] });
    expect(doc.content?.[1].content?.[0].marks).toEqual([{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.co' } }]);
    expect(doc.content?.[2]).toEqual({ type: 'image', attrs: { src: 'https://x.co/a.jpg', alt: 'A' } });
  });

  it('drops unknown nodes, unsafe links and images, and extra attributes', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'x' }] },
        { type: 'image', attrs: { src: 'javascript:alert(1)' } },
        { type: 'paragraph', attrs: { onclick: 'x' }, content: [{ type: 'text', text: 'ok', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'evil' }] }] },
      ],
    });
    expect(doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }]);
  });

  it('rejects anything that is not a document', () => {
    expect(() => sanitizeDoc('<p>hi</p>')).toThrow();
    expect(() => sanitizeDoc({ type: 'paragraph' })).toThrow();
  });

  it('gives an empty document one empty paragraph', () => {
    expect(sanitizeDoc({ type: 'doc', content: [] }).content).toEqual([{ type: 'paragraph' }]);
  });
});

describe('docText', () => {
  it('joins text across blocks', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hi' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'there 🎉' }] }] });
    expect(docText(doc)).toBe('Hi there 🎉');
  });
});

describe('firstImage', () => {
  it('finds the first image anywhere in the body', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'blockquote', content: [{ type: 'image', attrs: { src: 'https://x.co/a.jpg' } }] }] });
    expect(firstImage(doc)).toBe('https://x.co/a.jpg');
  });
  it('returns null when there is none', () => {
    expect(firstImage(sanitizeDoc({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBeNull();
  });
});
