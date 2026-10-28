export const BASE_DOCUMENT_TITLE = "Veydrift";

type TitleDocument = {
  title: string;
};

export function resetDocumentTitle(documentRef: TitleDocument | undefined = currentDocument()): void {
  if (!documentRef) return;
  documentRef.title = BASE_DOCUMENT_TITLE;
}

function currentDocument(): TitleDocument | undefined {
  return typeof document === "undefined" ? undefined : document;
}

// A page's own title, description and address in the head, for browser tabs, search engines and the
// copies of /docs and /calculator the image prerenders for crawlers (scripts/prerender.mjs). The site's
// address comes from the canonical link the build writes into index.html.
export function setPageHead({ title, description, path, image }: { title: string; description: string; path: string; image?: string }) {
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const url = canonical ? new URL(path, canonical.href).href : path;
  const set = (selector: string, attribute: string, value: string) => document.head.querySelector(selector)?.setAttribute(attribute, value);
  document.title = title;
  set('link[rel="canonical"]', "href", url);
  set('meta[property="og:url"]', "content", url);
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) set(selector, "content", title);
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) set(selector, "content", description);
  // The page's own share card (scripts/generate-page-og.mjs), 1200×630 like the site's.
  if (image) {
    const imageUrl = canonical ? new URL(image, canonical.href).href : image;
    for (const selector of ['meta[property="og:image"]', 'meta[property="og:image:secure_url"]', 'meta[name="twitter:image"]']) set(selector, "content", imageUrl);
    for (const selector of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) set(selector, "content", title);
  }
}
