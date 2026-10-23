import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Invoice, LegalSnapshot } from '@shared/types';
import { formatEuros, formatEurosPdf, formatQuantity } from '@shared/money';
import { formatDateFR } from '@shared/dates';
import { OPERATION_NATURE_LABEL, PAYMENT_METHOD_LABEL, formatAddressLines } from '@shared/constants';
import { buildLegalMentions } from '@shared/legal';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

interface PdfOptions {
  fontsDir: string;
  logo?: { buffer: Buffer; mime: string } | null;
  draft?: boolean;
  provisionalNumber?: string | null;
}

type Doc = PDFKit.PDFDocument;
interface Fonts {
  regular: string;
  bold: string;
  italic: string;
}

const COLORS = {
  dark: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f8fafc',
  white: '#ffffff',
};

const TABLE_COLUMNS = [
  { key: 'designation', x: 0, width: 174, align: 'left' as const },
  { key: 'reference', x: 174, width: 48, align: 'left' as const },
  { key: 'quantity', x: 222, width: 34, align: 'right' as const },
  { key: 'unit', x: 256, width: 40, align: 'right' as const },
  { key: 'unitPrice', x: 296, width: 64, align: 'right' as const },
  { key: 'discount', x: 360, width: 48, align: 'right' as const },
  { key: 'vat', x: 408, width: 30, align: 'right' as const },
  { key: 'total', x: 438, width: 73, align: 'right' as const },
];

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return [109, 92, 246];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

function registerFonts(doc: Doc, fontsDir: string): Fonts {
  const regular = path.join(fontsDir, 'DejaVuSans.ttf');
  const bold = path.join(fontsDir, 'DejaVuSans-Bold.ttf');
  const italic = path.join(fontsDir, 'DejaVuSans-Oblique.ttf');
  try {
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      doc.registerFont('FP', regular);
      doc.registerFont('FP-Bold', bold);
      doc.registerFont('FP-Italic', fs.existsSync(italic) ? italic : regular);
      return { regular: 'FP', bold: 'FP-Bold', italic: 'FP-Italic' };
    }
  } catch {
    /* repli sur les polices PDF standard */
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };
}

function safeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\u202f/g, '\u00a0')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function vatLabel(rateBp: number): string {
  if (rateBp === 0) return '0\u00a0%';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rateBp / 100)}\u00a0%`;
}

function rcsLabel(value: string): string {
  const clean = safeText(value);
  if (!clean) return '';
  return /^rcs\b/i.test(clean) ? clean : `RCS ${clean}`;
}

function sellerLegalLine(invoice: Invoice): string {
  const s = invoice.sellerSnapshot;
  const parts: string[] = [];
  if (s.legalName || s.tradeName || s.displayName) parts.push(s.legalName || s.tradeName || s.displayName);
  if (s.legalForm) parts.push(s.legalForm);
  if (s.capitalCents) parts.push(`capital ${formatEuros(s.capitalCents)}`);
  if (s.siren) parts.push(`SIREN ${s.siren}`);
  if (s.rcs) parts.push(rcsLabel(s.rcs));
  if (s.vatNumber) parts.push(`TVA ${s.vatNumber}`);
  return parts.join(' · ');
}

function sellerIdentityLines(s: Invoice['sellerSnapshot']): string[] {
  const lines: string[] = [];
  const form = s.legalForm ? s.legalForm : '';
  const capital = s.capitalCents ? ` au capital de ${formatEuros(s.capitalCents)}` : '';
  if (s.legalName && s.legalName !== s.tradeName && form) lines.push(`${s.legalName} — ${form}${capital}`);
  else if (form) lines.push(`${form}${capital}`);
  const ids: string[] = [];
  if (s.siren) ids.push(`SIREN ${s.siren}`);
  if (s.siret && s.siret !== s.siren) ids.push(`SIRET ${s.siret}`);
  if (s.rcs) ids.push(rcsLabel(s.rcs));
  if (s.rm) ids.push(/^rm\b/i.test(s.rm) ? s.rm : `RM ${s.rm}`);
  if (ids.length) lines.push(ids.join(' · '));
  const contact = [s.phone, s.email, s.website].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  if (s.ape) lines.push(`Code APE ${s.ape}`);
  return lines;
}

/* ------------------------------------------------------------------ */
/* Génération                                                          */
/* ------------------------------------------------------------------ */

export async function generateInvoicePdf(invoice: Invoice, options: PdfOptions): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: `${invoice.type === 'credit_note' ? 'Avoir' : 'Facture'} ${invoice.number ?? 'brouillon'}`,
      Author: invoice.sellerSnapshot.displayName || 'FacturePro',
      Subject: `Document de facturation ${invoice.number ?? ''}`.trim(),
      Creator: 'FacturePro',
      Producer: 'FacturePro',
    },
  });

  const fonts = registerFonts(doc, options.fontsDir);
  const primary = invoice.sellerSnapshot.primaryColor || '#6D5CF6';
  const onPrimary = isLight(primary) ? '#111827' : '#ffffff';
  const isCredit = invoice.type === 'credit_note';
  const legal: LegalSnapshot = invoice.legalSnapshot;
  const mentions = buildLegalMentions({
    legal,
    clientType: invoice.clientSnapshot.type,
    operationNature: invoice.operationNature,
    hasVat: invoice.totals.totalVatCents > 0,
  });
  const displayNumber = options.draft
    ? 'BROUILLON'
    : invoice.number ?? options.provisionalNumber ?? '—';
  const bottomLimit = A4.height - 92;

  const pageTopBar = (height = 6) => {
    doc.save();
    doc.rect(0, 0, A4.width, height).fill(primary);
    doc.rect(0, height, A4.width, 0.8).fill(COLORS.line);
    doc.restore();
  };

  const firstPage = () => {
    doc.addPage();
    pageTopBar();
    drawHeaderFirstPage(doc, invoice, fonts, primary, displayNumber, options);
    drawPartiesAndMeta(doc, invoice, fonts, primary);
    doc.y = 330;
  };

  const continuationPage = () => {
    doc.addPage();
    pageTopBar(5);
    drawHeaderContinuation(doc, invoice, fonts, primary, displayNumber);
  };

  const drawTableHead = (y: number): number => {
    doc.save();
    doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(primary);
    doc.restore();
    doc.font(fonts.bold).fontSize(6.6).fillColor(onPrimary);
    const labels = ['DÉSIGNATION', 'RÉF.', 'QTÉ', 'UNITÉ', 'P.U. HT', 'REMISE', 'TVA', 'TOTAL HT'];
    TABLE_COLUMNS.forEach((column, index) => {
      const padding = column.key === 'designation' ? 6 : 3;
      doc.text(labels[index], MARGIN + column.x + padding, y + 7, {
        width: column.width - padding - 3,
        align: column.align,
      });
    });
    return y + 22;
  };

  const drawTable = (startY: number): number => {
    let y = drawTableHead(startY);
    invoice.lines.forEach((line, index) => {
      const designation = safeText(line.designation) || '—';
      const description = safeText(line.description);
      const designationHeight = doc
        .font(fonts.regular)
        .fontSize(8)
        .heightOfString(designation, { width: TABLE_COLUMNS[0].width - 12 });
      const descriptionHeight = description
        ? doc.font(fonts.regular).fontSize(6.6).heightOfString(description, {
            width: TABLE_COLUMNS[0].width - 12,
          })
        : 0;
      const rowHeight = Math.max(20, designationHeight + descriptionHeight + 8);
      if (y + rowHeight > bottomLimit) {
        continuationPage();
        y = drawTableHead(MARGIN + 46);
      }
      if (index % 2 === 1) {
        doc.save();
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(COLORS.soft);
        doc.restore();
      }
      const textY = y + 6;
      doc.font(fonts.regular).fontSize(8).fillColor(COLORS.dark);
      doc.text(designation, MARGIN + 6, textY, { width: TABLE_COLUMNS[0].width - 12 });
      if (description) {
        doc.font(fonts.regular).fontSize(6.6).fillColor(COLORS.muted);
        doc.text(description, MARGIN + 6, textY + designationHeight + 1, {
          width: TABLE_COLUMNS[0].width - 12,
        });
      }
      const cellText = (
        colIndex: number,
        value: string,
        size = 7.4,
        font = fonts.regular,
        fill = COLORS.dark,
      ) => {
        const column = TABLE_COLUMNS[colIndex];
        doc.font(font).fontSize(size).fillColor(fill);
        doc.text(value, MARGIN + column.x + 3, textY + 1, {
          width: column.width - 6,
          align: column.align,
        });
      };
      cellText(1, safeText(line.reference) || '—', 6.8, fonts.regular, COLORS.muted);
      cellText(2, formatQuantity(line.quantity));
      cellText(3, safeText(line.unit) || 'unité', 7);
      cellText(4, formatEurosPdf(line.unitPriceCents));
      const discountLabel =
        line.discountCents > 0
          ? line.discountType === 'percent'
            ? `−${vatLabel(line.discountValue)}`
            : `−${formatEurosPdf(line.discountCents)}`
          : '—';
      cellText(5, discountLabel, 6.8, fonts.regular, line.discountCents > 0 ? '#b45309' : COLORS.muted);
      cellText(6, vatLabel(line.vatRateBp), 7);
      cellText(7, formatEurosPdf(line.netCents), 8, fonts.bold);
      doc
        .moveTo(MARGIN, y + rowHeight)
        .lineTo(MARGIN + CONTENT_WIDTH, y + rowHeight)
        .strokeColor(COLORS.line)
        .lineWidth(0.5)
        .stroke();
      y += rowHeight;
    });
    return y;
  };

  const drawTotals = (startY: number): number => {
    const boxWidth = 250;
    const x = A4.width - MARGIN - boxWidth;
    let y = startY;
    const totals = invoice.totals;
    type Row = { label: string; value: string; bold?: boolean; negative?: boolean };
    const rows: Row[] = [{ label: 'Sous-total HT', value: formatEurosPdf(totals.subtotalCents) }];
    if (totals.lineDiscountCents > 0) {
      rows.push({ label: 'Remises lignes', value: `−${formatEurosPdf(totals.lineDiscountCents)}`, negative: true });
    }
    if (totals.globalDiscountCents > 0) {
      rows.push({ label: 'Remise globale', value: `−${formatEurosPdf(totals.globalDiscountCents)}`, negative: true });
    }
    rows.push({ label: 'Total HT', value: formatEurosPdf(totals.totalHtCents), bold: true });
    for (const vat of totals.vatBreakdown) {
      rows.push({
        label: `TVA ${vatLabel(vat.rateBp)} sur ${formatEurosPdf(vat.baseCents)}`,
        value: formatEurosPdf(vat.vatCents),
      });
    }
    const needed = 20 + rows.length * 14 + 48 + (invoice.paidCents > 0 ? 22 : 0);
    if (y + needed > bottomLimit) {
      continuationPage();
      y = MARGIN + 62;
    }
    doc.font(fonts.bold).fontSize(7.2).fillColor(COLORS.muted);
    doc.text('RÉCAPITULATIF', x, y, { width: boxWidth });
    y += 15;
    for (const row of rows) {
      doc.fillColor(row.negative ? '#b45309' : COLORS.muted).font(row.bold ? fonts.bold : fonts.regular);
      doc.fontSize(7.8).text(row.label, x, y, { width: boxWidth - 88, lineBreak: false, ellipsis: true });
      doc.fillColor(COLORS.dark).font(row.bold ? fonts.bold : fonts.regular);
      doc.text(row.value, x + boxWidth - 88, y, { width: 88, align: 'right', lineBreak: false });
      y += 14;
    }
    y += 6;
    doc.save();
    doc.roundedRect(x, y, boxWidth, 30, 4).fill(primary);
    doc.restore();
    doc.font(fonts.bold).fontSize(8.6).fillColor(onPrimary);
    doc.text(isCredit ? 'TOTAL AVOIR TTC' : 'TOTAL TTC', x + 10, y + 10, { width: 120, lineBreak: false });
    doc.fontSize(11).text(formatEurosPdf(totals.totalTtcCents), x + 116, y + 8, {
      width: boxWidth - 126,
      align: 'right',
      lineBreak: false,
    });
    y += 40;
    if (invoice.paidCents > 0 || (invoice.creditedCents > 0 && invoice.type === 'invoice' && invoice.balanceCents > 0)) {
      doc.font(fonts.regular).fontSize(7.2).fillColor(COLORS.muted);
      if (invoice.paidCents > 0) {
        doc.text(`Déjà réglé : ${formatEurosPdf(invoice.paidCents)}`, x, y, { width: boxWidth, align: 'right' });
        y += 10;
      }
      if (invoice.balanceCents > 0 && invoice.paidCents > 0) {
        doc.font(fonts.bold).fillColor('#b45309');
        doc.text(`Solde restant dû : ${formatEurosPdf(invoice.balanceCents)}`, x, y, {
          width: boxWidth,
          align: 'right',
        });
        y += 10;
      }
    }
    return y;
  };

  const drawPaymentAndNotes = (startY: number): number => {
    const bank = invoice.sellerSnapshot.bank;
    const hasBank = Boolean(bank.iban || bank.bankName || bank.paymentInstructions);
    const notes = safeText(invoice.notes);
    if (!hasBank && !notes) return startY;
    let y = startY + 4;
    const leftWidth = hasBank ? 260 : CONTENT_WIDTH;
    const bankRows: string[] = [];
    if (bank.bankName) bankRows.push(`Banque : ${bank.bankName}`);
    if (bank.accountHolder) bankRows.push(`Titulaire : ${bank.accountHolder}`);
    if (bank.iban) bankRows.push(`IBAN : ${bank.iban}`);
    if (bank.bic) bankRows.push(`BIC : ${bank.bic}`);
    const bankHeight = hasBank ? 30 + bankRows.length * 10 + (bank.paymentInstructions ? 20 : 0) : 0;
    doc.font(fonts.regular).fontSize(7);
    const notesHeight = notes ? doc.heightOfString(notes, { width: CONTENT_WIDTH - (hasBank ? leftWidth + 16 : 0) }) : 0;
    const height = Math.max(bankHeight, notesHeight + 20);
    if (y + Math.min(height, 160) > bottomLimit) {
      continuationPage();
      y = MARGIN + 62;
    }
    if (hasBank) {
      doc.save();
      doc.roundedRect(MARGIN, y, leftWidth, bankHeight, 4).fill(COLORS.soft).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.restore();
      doc.font(fonts.bold).fontSize(7).fillColor(primary);
      doc.text('COORDONNÉES BANCAIRES', MARGIN + 10, y + 8, { width: leftWidth - 20 });
      doc.font(fonts.regular).fontSize(7).fillColor(COLORS.body);
      let ry = y + 21;
      for (const row of bankRows) {
        doc.text(row, MARGIN + 10, ry, { width: leftWidth - 20, lineBreak: false, ellipsis: true });
        ry += 10;
      }
      if (bank.paymentInstructions) {
        doc.fontSize(6.6).fillColor(COLORS.muted);
        doc.text(bank.paymentInstructions, MARGIN + 10, ry + 1, { width: leftWidth - 20 });
      }
      doc.font(fonts.regular).fontSize(6.8).fillColor(COLORS.body);
      // Un avoir n'est jamais « à régler » : on rappelle le mode de remboursement.
      doc.text(
        invoice.type === 'credit_note'
          ? `Remboursement par ${(PAYMENT_METHOD_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod).toLowerCase()} ou compensation avec les sommes dues.`
          : `À régler avant le ${formatDateFR(invoice.dueDate)} — ${PAYMENT_METHOD_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod}.`,
        MARGIN,
        y + bankHeight + 5,
        { width: leftWidth },
      );
    }
    const rightX = hasBank ? MARGIN + leftWidth + 16 : MARGIN;
    const rightWidth = CONTENT_WIDTH - (hasBank ? leftWidth + 16 : 0);
    if (notes) {
      let ny = y;
      doc.font(fonts.bold).fontSize(7).fillColor(COLORS.muted);
      doc.text('NOTES', rightX, ny, { width: rightWidth });
      doc.font(fonts.regular).fontSize(7).fillColor(COLORS.body);
      doc.text(notes, rightX, ny + 11, { width: rightWidth, lineGap: 1 });
      ny += notesHeight + 24;
      y = Math.max(y + bankHeight + 18, ny);
    } else {
      y = y + bankHeight + 18;
    }
    return y;
  };

  const drawMentions = (startY: number): number => {
    if (!mentions.length) return startY;
    // On mesure le bloc entier avant de l'imprimer : si les mentions légales
    // ne tiennent pas sur la page courante, elles basculent ensemble sur une
    // page dédiée plutôt que de laisser une ligne orpheline en bas de page.
    doc.font(fonts.regular).fontSize(6.6);
    const heights = mentions.map((mention) =>
      doc.heightOfString(mention.text, { width: CONTENT_WIDTH, lineGap: 1 }),
    );
    // Bloc = filet de séparation (4 pt) + titre (10 pt) + une entrée par mention.
    const blockHeight = heights.reduce((sum, height) => sum + height + 4, 0) + 14;
    let y = startY + 4;
    if (y + blockHeight > bottomLimit && blockHeight <= bottomLimit - (MARGIN + 62)) {
      continuationPage();
      y = MARGIN + 62;
    }
    doc.moveTo(MARGIN, y).lineTo(A4.width - MARGIN, y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    y += 7;
    doc.font(fonts.bold).fontSize(7).fillColor(COLORS.muted);
    doc.text('MENTIONS LÉGALES', MARGIN, y, { width: CONTENT_WIDTH });
    y += 11;
    mentions.forEach((mention, index) => {
      const height = heights[index];
      if (y + height + 4 > bottomLimit) {
        continuationPage();
        y = MARGIN + 62;
      }
      doc.font(fonts.regular).fontSize(6.6).fillColor('#475569');
      doc.text(mention.text, MARGIN, y, { width: CONTENT_WIDTH, lineGap: 1 });
      y += height + 4;
    });
    return y;
  };

  firstPage();
  let tableY = doc.y;
  if (safeText(invoice.description)) {
    doc.font(fonts.bold).fontSize(6.6).fillColor(COLORS.muted);
    doc.text('OBJET', MARGIN, tableY, { width: CONTENT_WIDTH });
    doc.font(fonts.regular).fontSize(7.2).fillColor(COLORS.body);
    doc.text(safeText(invoice.description), MARGIN, tableY + 10, { width: CONTENT_WIDTH, lineGap: 1 });
    tableY = doc.y + 10;
  }
  tableY = Math.max(tableY, 348);
  tableY = drawTable(tableY);
  let y = drawTotals(tableY + 18);
  y = drawPaymentAndNotes(y);
  y = drawMentions(y);

  if (options.draft) {
    doc.save();
    doc.rotate(-32, { origin: [A4.width / 2, A4.height / 2] });
    doc.font(fonts.bold).fontSize(64).fillColor('#0f172a').opacity(0.055);
    doc.text('APERÇU', A4.width / 2 - 180, A4.height / 2 - 30, { width: 360, align: 'center' });
    doc.opacity(1);
    doc.restore();
  }

  /* Pieds de page (après pagination complète). */
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    const previousBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = A4.height - 44;
    doc
      .moveTo(MARGIN, footerY - 8)
      .lineTo(A4.width - MARGIN, footerY - 8)
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .stroke();
    doc.font(fonts.regular).fontSize(6.1).fillColor(COLORS.muted);
    doc.text(sellerLegalLine(invoice), MARGIN, footerY, {
      width: CONTENT_WIDTH - 158,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(
      `${isCredit ? 'Avoir' : 'Facture'} ${displayNumber} — page ${i + 1}/${total}`,
      MARGIN + CONTENT_WIDTH - 158,
      footerY,
      { width: 158, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = previousBottom;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/* ------------------------------------------------------------------ */
/* Blocs                                                               */
/* ------------------------------------------------------------------ */

function drawHeaderFirstPage(
  doc: Doc,
  invoice: Invoice,
  fonts: Fonts,
  primary: string,
  displayNumber: string,
  options: PdfOptions,
): void {
  const seller = invoice.sellerSnapshot;
  const top = 30;
  const rightX = A4.width - MARGIN - 196;
  let textX = MARGIN;
  if (options.logo) {
    try {
      // `fit` préserve le ratio du logo sans déformation.
      doc.image(options.logo.buffer, MARGIN, top + 2, { fit: [96, 48] });
      textX = MARGIN + 112;
    } catch {
      textX = MARGIN;
    }
  }
  const companyWidth = rightX - textX - 12;
  doc.font(fonts.bold).fontSize(12).fillColor(COLORS.dark);
  doc.text(safeText(seller.tradeName || seller.legalName || seller.displayName) || 'Votre entreprise', textX, top, {
    width: companyWidth,
    ellipsis: true,
  });
  doc.font(fonts.regular).fontSize(6.6).fillColor(COLORS.muted);
  let infoY = top + 17;
  for (const line of sellerIdentityLines(seller).slice(0, 3)) {
    doc.text(line, textX, infoY, { width: companyWidth, lineBreak: false, ellipsis: true });
    infoY += 8.5;
  }
  const addressLines = formatAddressLines(seller.address);
  if (addressLines.length) {
    doc.text(addressLines.join(' · '), textX, infoY, {
      width: companyWidth,
      lineBreak: false,
      ellipsis: true,
    });
  }

  doc.font(fonts.bold).fontSize(23).fillColor(primary);
  doc.text(invoice.type === 'credit_note' ? 'AVOIR' : 'FACTURE', rightX, top - 4, {
    width: 196,
    align: 'right',
  });
  doc.font(fonts.bold).fontSize(10.5).fillColor(COLORS.dark);
  doc.text(displayNumber, rightX, top + 25, { width: 196, align: 'right', lineBreak: false });
  doc.font(fonts.regular).fontSize(6.8).fillColor(COLORS.muted);
  doc.text(`Émise le ${formatDateFR(invoice.issueDate)}`, rightX, top + 41, {
    width: 196,
    align: 'right',
  });
  if (invoice.type === 'credit_note' && invoice.sourceInvoiceNumber) {
    doc.text(`Avoir sur facture ${invoice.sourceInvoiceNumber}`, rightX, top + 51, {
      width: 196,
      align: 'right',
    });
  } else {
    doc.text(`Réalisée le ${formatDateFR(invoice.serviceDate)}`, rightX, top + 51, {
      width: 196,
      align: 'right',
    });
  }
  doc
    .moveTo(MARGIN, 126)
    .lineTo(A4.width - MARGIN, 126)
    .strokeColor(COLORS.line)
    .lineWidth(0.6)
    .stroke();
}

function drawPartiesAndMeta(doc: Doc, invoice: Invoice, fonts: Fonts, primary: string): void {
  const top = 140;
  const boxHeight = 78;
  const hasDelivery = Boolean(invoice.deliveryAddress);
  const boxWidth = hasDelivery ? (CONTENT_WIDTH - 14) / 2 : CONTENT_WIDTH * 0.58;
  const client = invoice.clientSnapshot;

  doc.font(fonts.bold).fontSize(6.4).fillColor(primary);
  doc.text('FACTURÉ À', MARGIN, top, { width: boxWidth });
  doc.save();
  doc.roundedRect(MARGIN, top + 11, boxWidth, boxHeight, 4).fill(COLORS.soft).strokeColor(COLORS.line).lineWidth(0.5).stroke();
  doc.restore();
  doc.font(fonts.bold).fontSize(9).fillColor(COLORS.dark);
  doc.text(safeText(client.companyName || client.displayName) || 'Client', MARGIN + 10, top + 19, {
    width: boxWidth - 20,
    ellipsis: true,
  });
  const addressLines = formatAddressLines(invoice.billingAddress);
  const identityLine =
    client.type === 'professionnel' && client.firstName && client.lastName && client.companyName
      ? [client.firstName, client.lastName].filter(Boolean).join(' ')
      : '';
  const identifiers = [
    client.siren ? `SIREN ${client.siren}` : '',
    client.vatNumber ? `TVA ${client.vatNumber}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // Le SIREN du client est une mention obligatoire (art. 242 nonies A, 1° ann.
  // II CGI) : on réserve toujours sa place et on ne tronque que l'adresse.
  const maxAddressLines = Math.max(1, 4 - (identityLine ? 1 : 0));
  const lines = [identityLine, ...addressLines.slice(0, maxAddressLines), identifiers].filter(Boolean);
  doc.font(fonts.regular).fontSize(6.8).fillColor(COLORS.body);
  let cy = top + 32;
  for (const line of lines) {
    doc.text(line, MARGIN + 10, cy, { width: boxWidth - 20, lineBreak: false, ellipsis: true });
    cy += 9.5;
  }

  if (invoice.deliveryAddress) {
    const dx = MARGIN + boxWidth + 14;
    doc.font(fonts.bold).fontSize(6.4).fillColor(primary);
    doc.text('ADRESSE DE LIVRAISON', dx, top, { width: boxWidth });
    doc.save();
    doc.roundedRect(dx, top + 11, boxWidth, boxHeight, 4).fill(COLORS.soft).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.restore();
    doc.font(fonts.regular).fontSize(6.8).fillColor(COLORS.body);
    let dy = top + 19;
    for (const line of formatAddressLines(invoice.deliveryAddress).slice(0, 5)) {
      doc.text(line, dx + 10, dy, { width: boxWidth - 20, lineBreak: false, ellipsis: true });
      dy += 9.5;
    }
  }

  const metaTop = top + boxHeight + 22;
  const cells: { label: string; value: string }[] = [
    { label: 'DATE DE PRESTATION', value: formatDateFR(invoice.serviceDate) },
    { label: 'ÉCHÉANCE', value: formatDateFR(invoice.dueDate) },
    { label: 'MODE DE PAIEMENT', value: PAYMENT_METHOD_LABEL[invoice.paymentMethod] ?? invoice.paymentMethod },
    { label: 'BON DE COMMANDE', value: invoice.purchaseOrder || '—' },
    { label: 'NATURE DE L’OPÉRATION', value: OPERATION_NATURE_LABEL[invoice.operationNature] },
    { label: 'CONDITIONS DE RÈGLEMENT', value: invoice.paymentTerms || '—' },
  ];
  const cols = 3;
  const cellW = CONTENT_WIDTH / cols;
  doc.font(fonts.bold).fontSize(6).fillColor(primary);
  doc.text('INFORMATIONS DU DOCUMENT', MARGIN, metaTop, { width: CONTENT_WIDTH });
  doc
    .moveTo(MARGIN, metaTop + 9)
    .lineTo(MARGIN + CONTENT_WIDTH, metaTop + 9)
    .strokeColor(COLORS.line)
    .lineWidth(0.5)
    .stroke();
  cells.forEach((cell, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = MARGIN + col * cellW;
    const y = metaTop + 16 + row * 25;
    doc.font(fonts.bold).fontSize(5.6).fillColor(COLORS.muted);
    doc.text(cell.label, x, y, { width: cellW - 10, lineBreak: false });
    doc.font(fonts.regular).fontSize(7.2).fillColor(COLORS.dark);
    doc.text(cell.value, x, y + 8, { width: cellW - 10, lineBreak: false, ellipsis: true });
  });
  doc.y = metaTop + 16 + Math.ceil(cells.length / cols) * 25;
}

function drawHeaderContinuation(
  doc: Doc,
  invoice: Invoice,
  fonts: Fonts,
  primary: string,
  displayNumber: string,
): void {
  const seller = invoice.sellerSnapshot;
  doc.font(fonts.bold).fontSize(8.5).fillColor(COLORS.dark);
  doc.text(safeText(seller.tradeName || seller.legalName || seller.displayName) || 'FacturePro', MARGIN, 24, {
    width: 280,
    ellipsis: true,
  });
  doc.font(fonts.regular).fontSize(6.4).fillColor(COLORS.muted);
  doc.text(formatAddressLines(seller.address).join(' · '), MARGIN, 35, {
    width: 300,
    lineBreak: false,
    ellipsis: true,
  });
  doc.font(fonts.bold).fontSize(9).fillColor(primary);
  doc.text(
    `${invoice.type === 'credit_note' ? 'AVOIR' : 'FACTURE'} ${displayNumber}`,
    A4.width - MARGIN - 210,
    24,
    { width: 210, align: 'right' },
  );
  doc.font(fonts.regular).fontSize(6.4).fillColor(COLORS.muted);
  doc.text(`Émise le ${formatDateFR(invoice.issueDate)}`, A4.width - MARGIN - 210, 35, {
    width: 210,
    align: 'right',
  });
  doc
    .moveTo(MARGIN, 48)
    .lineTo(A4.width - MARGIN, 48)
    .strokeColor(COLORS.line)
    .lineWidth(0.5)
    .stroke();
}
