/**
 * Makes a chapter's document safe to show in an iframe that is allowed to
 * run scripts.
 *
 * Why the iframe runs scripts at all: WebKit (Safari, and the macOS app,
 * since Tauri uses WKWebView there) never calls event listeners inside a
 * sandboxed iframe that lacks `allow-scripts`, not even listeners the parent
 * page added. Chromium does call them, which is why everything worked on the
 * web and on Android but not on a Mac: the wheel never reached the chapter
 * pull, keys and touches inside the text were dropped, and so on. So the
 * rendition is created with `allowScriptedContent: true`, and this hook
 * keeps the book's own code from ever running instead.
 *
 * Two layers, so one mistake is not enough:
 *  1. Strip every script, inline event handler and `javascript:` URL.
 *  2. Put a Content-Security-Policy first in <head> that forbids all script
 *     and plugins in the document, catching anything layer 1 missed.
 *
 * Runs as an epub.js spine content hook, on the parsed document before it is
 * serialized into the iframe's srcdoc, so nothing has had a chance to run.
 */
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const CSP = "script-src 'none'; object-src 'none'";
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'data', 'xlink:href'];

export function sanitizeChapter(doc: Document): void {
  const root = doc.documentElement;
  if (!root) return;

  for (const tag of ['script', 'object', 'embed']) {
    for (const el of Array.from(doc.getElementsByTagNameNS('*', tag))) el.remove();
  }

  for (const el of Array.from(doc.getElementsByTagNameNS('*', '*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const isHandler = name.startsWith('on');
      const isScriptUrl =
        URL_ATTRS.includes(name) && /^\s*(javascript:|vbscript:|data:text\/html)/i.test(attr.value.replace(/[\u0000-\u001f]/g, ''));
      if (isHandler || isScriptUrl) el.removeAttributeNode(attr);
    }
  }

  const ns = root.namespaceURI || XHTML_NS;
  let head = doc.getElementsByTagNameNS('*', 'head')[0];
  if (!head) {
    head = doc.createElementNS(ns, 'head');
    root.insertBefore(head, root.firstChild);
  }
  const meta = doc.createElementNS(ns, 'meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', CSP);
  head.insertBefore(meta, head.firstChild);
}
