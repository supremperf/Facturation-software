import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfExtract {
  pages: number;
  text: string;
  pageTexts: string[];
  outOfBounds: { page: number; text: string; x: number; y: number }[];
}

/** Extrait le texte et vérifie la géométrie de chaque fragment. */
export async function extractPdf(buffer: Buffer): Promise<PdfExtract> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
  const pageTexts: string[] = [];
  const outOfBounds: PdfExtract['outOfBounds'] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const text = item.str;
      if (!text) continue;
      parts.push(text);
      const transform = item.transform as number[];
      const x = transform[4];
      const y = transform[5];
      const width = 'width' in item ? Number(item.width) : 0;
      if (x < -1 || y < -1 || x + width > viewport.width + 1 || y > viewport.height + 1) {
        outOfBounds.push({ page: i, text, x, y });
      }
    }
    pageTexts.push(parts.join(' '));
  }
  await doc.destroy();
  return { pages: doc.numPages, text: pageTexts.join('\n'), pageTexts, outOfBounds };
}
