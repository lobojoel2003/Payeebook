import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from 'pdf-lib';
import { winAnsi } from './text';

export const PAGE = { width: 612, height: 792, margin: 54 };
export const INK = rgb(0.11, 0.14, 0.19);
export const MUTED = rgb(0.38, 0.42, 0.48);
export const RULE = rgb(0.82, 0.84, 0.86);
export const BRAND = rgb(0.122, 0.373, 0.31);
export const PASS = rgb(0.13, 0.48, 0.33);
export const FAIL = rgb(0.71, 0.2, 0.16);
export const WARN = rgb(0.66, 0.45, 0.05);
export const TINT = rgb(0.95, 0.96, 0.95);

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** Minimal flowing layout on top of pdf-lib: a cursor, wrapping and page breaks. */
export class Writer {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];
  private constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private header?: (w: Writer) => void,
  ) {}

  static async create(title: string, header?: (w: Writer) => void): Promise<Writer> {
    const doc = await PDFDocument.create();
    doc.setTitle(winAnsi(title));
    doc.setCreator('Payeebook');
    doc.setProducer('Payeebook (pdf-lib)');
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };
    const w = new Writer(doc, fonts, header);
    w.newPage();
    return w;
  }

  get contentWidth() {
    return PAGE.width - PAGE.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - PAGE.margin;
    if (this.pages.length > 1 && this.header) this.header(this);
  }

  ensure(height: number) {
    if (this.y - height < PAGE.margin + 24) this.newPage();
  }

  width(text: string, size: number, font: PDFFont = this.fonts.regular) {
    return font.widthOfTextAtSize(winAnsi(text), size);
  }

  wrap(text: string, size: number, maxWidth: number, font: PDFFont = this.fonts.regular): string[] {
    const lines: string[] = [];
    for (const para of winAnsi(text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        // Break very long words (account numbers, URLs).
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {},
  ) {
    this.page.drawText(winAnsi(text), {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? this.fonts.regular,
      color: opts.color ?? INK,
    });
  }

  textRight(
    text: string,
    right: number,
    y: number,
    opts: { size?: number; font?: PDFFont; color?: RGB } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fonts.regular;
    this.text(text, right - this.width(text, size, font), y, { ...opts, size, font });
  }

  /** Write a wrapped paragraph at the cursor and advance it. */
  paragraph(
    text: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: RGB;
      indent?: number;
      gap?: number;
      width?: number;
    } = {},
  ) {
    const size = opts.size ?? 10;
    const lh = size * 1.4;
    const indent = opts.indent ?? 0;
    const lines = this.wrap(text, size, (opts.width ?? this.contentWidth) - indent, opts.font);
    for (const line of lines) {
      this.ensure(lh);
      this.text(line, PAGE.margin + indent, this.y - size, {
        size,
        font: opts.font,
        color: opts.color,
      });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 4;
  }

  rule(color: RGB = RULE, thickness = 0.75) {
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness,
      color,
    });
  }

  space(h: number) {
    this.y -= h;
  }

  heading(text: string, size = 13) {
    this.ensure(size * 3);
    this.y -= 6;
    this.text(text, PAGE.margin, this.y - size, { size, font: this.fonts.bold, color: BRAND });
    this.y -= size + 6;
    this.rule(BRAND, 1);
    this.y -= 8;
  }

  footer(left: string) {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      const y = PAGE.margin / 2;
      p.drawLine({
        start: { x: PAGE.margin, y: y + 12 },
        end: { x: PAGE.width - PAGE.margin, y: y + 12 },
        thickness: 0.5,
        color: RULE,
      });
      p.drawText(winAnsi(left), {
        x: PAGE.margin,
        y,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
      const right = `Page ${i + 1} of ${total}`;
      p.drawText(right, {
        x: PAGE.width - PAGE.margin - this.fonts.regular.widthOfTextAtSize(right, 7.5),
        y,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
    });
  }
}
