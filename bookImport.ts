import JSZipLib from 'jszip';
import { detectLocale, translate } from './i18n';

type JSZip = import('jszip');

const HTML_EXTS = ['.html', '.htm'];
const EPUB_EXTS = ['.epub'];
const PDF_EXTS = ['.pdf'];
const FB2_EXTS = ['.fb2'];

export function isSupportedBookFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return true;
  return [...HTML_EXTS, ...EPUB_EXTS, ...PDF_EXTS, ...FB2_EXTS].some(ext => lower.endsWith(ext));
}

function zipClass(): typeof JSZipLib {
  const mod = JSZipLib as unknown as { default?: typeof JSZipLib };
  return mod.default ?? JSZipLib;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function normalizeZipPath(path: string): string {
  return safeDecode(path.replace(/\\/g, '/').replace(/^\//, '')).toLowerCase();
}

function zipEntry(zip: JSZip, path: string) {
  const want = normalizeZipPath(path);
  const direct = zip.file(path) || zip.file(safeDecode(path));
  if (direct) return direct;
  const names = Object.keys(zip.files);
  const exact = names.find(name => !zip.files[name].dir && normalizeZipPath(name) === want);
  if (exact) return zip.file(exact);
  const suffix = names.find(name => {
    if (zip.files[name].dir) return false;
    const n = normalizeZipPath(name);
    return n === want || n.endsWith(`/${want}`);
  });
  return suffix ? zip.file(suffix) : null;
}

function resolveZipPath(baseDir: string, href: string): string {
  const raw = href.split('#')[0];
  if (!raw) return '';
  if (/^https?:/i.test(raw)) return '';
  const combined = baseDir ? `${baseDir}${raw}` : raw;
  const parts: string[] = [];
  for (const part of combined.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function xmlTagAttrs(xml: string, localName: string): Record<string, string>[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b([^>/]*)`, 'gi');
  const all: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const a: Record<string, string> = {};
    const attrRe = /([:\w.-]+)\s*=\s*["']([^"']*)["']/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(m[1]))) {
      const key = am[1].toLowerCase();
      a[key] = am[2];
      a[key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key] = am[2];
    }
    all.push(a);
  }
  return all;
}

function decodeText(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 800));
  const enc = (head.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1] || 'utf-8').toLowerCase();
  const aliases: Record<string, string> = {
    'windows-1251': 'windows-1251',
    'cp1251': 'windows-1251',
    'win-1251': 'windows-1251',
    'koi8-r': 'koi8-r',
    'iso-8859-1': 'iso-8859-1',
    'latin1': 'iso-8859-1',
  };
  const label = aliases[enc] || (enc === 'utf8' ? 'utf-8' : enc);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1251').decode(bytes);
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  }
}

function isFictionBook(text: string): boolean {
  return /<FictionBook[\s>]/i.test(text) || /fictionbook\/2\.0/i.test(text.slice(0, 4000));
}

function isZip(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function markupToParagraphs(markup: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,img,nav').forEach(el => el.remove());
  const root = doc.body || doc.documentElement;
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) parts.push(`<p>${escapeHtml(text)}</p>`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'svg', 'img', 'head', 'meta', 'link', 'nav'].includes(tag)) return;
    if (/^h[1-6]$/.test(tag)) {
      const title = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (title) {
        const level = Math.min(parseInt(tag[1], 10), 3);
        parts.push(`<h${level}>${escapeHtml(title)}</h${level}>`);
      }
      return;
    }
    if (['p', 'li', 'blockquote', 'dd', 'pre', 'figcaption', 'td', 'th'].includes(tag)) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) parts.push(`<p>${escapeHtml(text)}</p>`);
      return;
    }
    Array.from(el.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  if (parts.length) return parts.join('\n');

  const fallback = decodeEntities(
    markup
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|title|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
  return fallback
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}

function xmlEls(root: Document | Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', tag));
}

function xmlFirst(root: Document | Element, tag: string): Element | undefined {
  return xmlEls(root, tag)[0];
}

function elName(el: Element): string {
  return (el.localName || el.tagName).replace(/^.*:/, '').toLowerCase();
}

function elText(el: Element | undefined | null): string {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function repairFb2Xml(xml: string): string {
  return xml
    .replace(/<binary\b[^>]*>[\s\S]*?<\/binary>/gi, '')
    .replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]+;)/g, '&amp;');
}

function fb2ToHtmlRegex(xml: string): string {
  const titleMatch = xml.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/i);
  const title = decodeEntities((titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  if (title) parts.push(`<h1>${escapeHtml(title)}</h1>`);

  const bodyChunks = xml.match(/<body\b[\s\S]*?<\/body>/gi) || [xml];
  for (const body of bodyChunks) {
    const headingRe = /<(title|subtitle)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cursor = 0;
    let hm: RegExpExecArray | null;
    const emitText = (chunk: string) => {
      const blocks = chunk.match(/<(p|v|text-author)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
      if (blocks.length) {
        for (const block of blocks) {
          const text = decodeEntities(block.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
          if (text) parts.push(`<p>${escapeHtml(text)}</p>`);
        }
        return;
      }
      const html = markupToParagraphs(chunk);
      if (html.trim()) parts.push(html);
    };
    while ((hm = headingRe.exec(body))) {
      emitText(body.slice(cursor, hm.index));
      const heading = decodeEntities(hm[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (heading && heading !== title) {
        parts.push(hm[1].toLowerCase() === 'subtitle' ? `<h3>${escapeHtml(heading)}</h3>` : `<h2>${escapeHtml(heading)}</h2>`);
      }
      cursor = hm.index + hm[0].length;
    }
    emitText(body.slice(cursor));
  }
  return parts.join('\n');
}

function fb2ToHtml(xml: string): string {
  const cleaned = repairFb2Xml(xml);

  const walkFb2 = (el: Element, out: string[], title: string, depth: number) => {
    const tag = elName(el);
    if (['binary', 'image', 'stylesheet'].includes(tag)) return;
    if (tag === 'title') {
      const text = elText(el);
      if (text && text !== title) {
        const level = Math.min(Math.max(depth, 2), 3);
        out.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
      }
      return;
    }
    if (tag === 'subtitle') {
      const text = elText(el);
      if (text) out.push(`<h3>${escapeHtml(text)}</h3>`);
      return;
    }
    if (['p', 'v', 'text-author'].includes(tag)) {
      const text = elText(el);
      if (text) out.push(`<p>${escapeHtml(text)}</p>`);
      return;
    }
    const next = tag === 'section' ? depth + 1 : depth;
    Array.from(el.children).forEach(child => walkFb2(child, out, title, next));
  };

  const doc = new DOMParser().parseFromString(cleaned, 'text/xml');
  const parts: string[] = [];
  if (!doc.getElementsByTagName('parsererror').length) {
    const bookTitle = elText(xmlFirst(doc, 'book-title'));
    if (bookTitle) parts.push(`<h1>${escapeHtml(bookTitle)}</h1>`);
    const titleInfo = xmlFirst(doc, 'title-info');
    if (titleInfo) {
      const author = xmlEls(titleInfo, 'author').map(a => {
        const name = [elText(xmlFirst(a, 'first-name')), elText(xmlFirst(a, 'middle-name')), elText(xmlFirst(a, 'last-name'))]
          .filter(Boolean)
          .join(' ');
        return name || elText(xmlFirst(a, 'nickname'));
      }).filter(Boolean).join(', ');
      if (author) parts.push(`<p>${escapeHtml(author)}</p>`);
      const annotation = xmlFirst(titleInfo, 'annotation');
      if (annotation) walkFb2(annotation, parts, bookTitle, 1);
    }
    for (const body of xmlEls(doc, 'body')) walkFb2(body, parts, bookTitle, 1);
  }

  const joined = parts.join('\n');
  if (joined.trim()) return joined;
  const fallback = fb2ToHtmlRegex(cleaned);
  if (fallback.trim()) return fallback;
  throw new Error('fb2-empty');
}

function isHtmlHref(media: string, href: string): boolean {
  const m = media.toLowerCase();
  const h = href.toLowerCase();
  if (m.includes('ncx') || h.endsWith('.ncx') || h.endsWith('.opf') || h.endsWith('.css')) return false;
  if (m.includes('image') || m.includes('font') || m.includes('audio') || m.includes('video')) return false;
  return m.includes('html') || /\.(x?html?|xml)$/i.test(h);
}

async function htmlFromSpine(zip: JSZip, opfPath: string): Promise<string> {
  const opfXml = await zipEntry(zip, opfPath)?.async('string');
  if (!opfXml) return '';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const hrefById = new Map<string, string>();
  for (const item of xmlTagAttrs(opfXml, 'item')) {
    const id = item.id || '';
    const href = item.href || '';
    if (!id || !href) continue;
    if (isHtmlHref(item['media-type'] || item.mediatype || '', href)) hrefById.set(id, href);
  }
  let spineHrefs = xmlTagAttrs(opfXml, 'itemref')
    .map(ref => hrefById.get(ref.idref || '') || '')
    .filter(Boolean);
  if (!spineHrefs.length) spineHrefs = [...hrefById.values()];

  const chapters: string[] = [];
  for (const href of spineHrefs) {
    const path = resolveZipPath(opfDir, href);
    const xhtml = await zipEntry(zip, path)?.async('string');
    if (!xhtml) continue;
    const html = markupToParagraphs(xhtml);
    if (html.trim()) chapters.push(html);
  }
  return chapters.join('\n');
}

function isChapterFile(name: string): boolean {
  const n = name.toLowerCase();
  if (/meta-inf\//.test(n) || n.endsWith('.opf') || n.endsWith('.ncx') || n.endsWith('.css')) return false;
  return /\.(x?html?|xml|fb2)$/i.test(n);
}

async function htmlFromZipFiles(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && isChapterFile(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const chapters: string[] = [];
  for (const name of names) {
    const bytes = await zip.files[name].async('uint8array');
    const text = decodeText(bytes);
    if (isFictionBook(text)) {
      try {
        chapters.push(fb2ToHtml(text));
        continue;
      } catch {
        /* fall through */
      }
    }
    const html = markupToParagraphs(text);
    if (html.trim()) chapters.push(html);
  }
  return chapters.join('\n');
}

async function epubToHtml(buffer: ArrayBuffer): Promise<string> {
  const zip = await zipClass().loadAsync(new Uint8Array(buffer));
  const containerXml = await zipEntry(zip, 'META-INF/container.xml')?.async('string');
  if (containerXml) {
    const root = xmlTagAttrs(containerXml, 'rootfile')[0];
    const opfPath = (root?.['full-path'] || root?.fullpath || '').replace(/\\/g, '/');
    if (opfPath) {
      const fromOpf = await htmlFromSpine(zip, opfPath);
      if (fromOpf.trim()) return fromOpf;
    }
  }
  const fromFiles = await htmlFromZipFiles(zip);
  if (fromFiles.trim()) return fromFiles;
  throw new Error('epub-empty');
}

async function pdfToHtml(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const locale = detectLocale();
  const parts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      pageText += item.str;
      pageText += item.hasEOL ? '\n' : ' ';
    }
    const paragraphs = pageText
      .split(/\n{2,}|\r\n{2,}/)
      .map(block => block.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!paragraphs.length) continue;
    parts.push(`<h2>${escapeHtml(translate(locale, 'pageN', { n: pageNum }))}</h2>`);
    for (const para of paragraphs) parts.push(`<p>${escapeHtml(para)}</p>`);
  }

  const joined = parts.join('\n');
  if (!joined.trim()) throw new Error('pdf-empty');
  return joined;
}

export async function fileToBookHtml(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (HTML_EXTS.some(ext => lower.endsWith(ext))) {
    return file.text();
  }
  const buffer = await file.arrayBuffer();
  if (PDF_EXTS.some(ext => lower.endsWith(ext))) {
    return pdfToHtml(buffer);
  }

  if (isZip(buffer)) {
    return epubToHtml(buffer);
  }

  const text = decodeText(buffer);
  if (isFictionBook(text) || FB2_EXTS.some(ext => lower.endsWith(ext))) {
    return fb2ToHtml(text);
  }

  throw new Error('unsupported');
}
