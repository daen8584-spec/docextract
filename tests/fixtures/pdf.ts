import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/**
 * Builds a minimal, valid PDF with one page per entry in `pages`, each showing its
 * lines in Helvetica. Pass an empty page to get a page without a text layer, like a
 * scanned document. Only ASCII text is supported.
 */
export function makePdf(pages: string[][]): Uint8Array<ArrayBuffer> {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const content = lines.length
      ? ["BT", "/F1 12 Tf", "72 720 Td", "16 TL", ...lines.map((line) => `(${escape(line)}) Tj T*`), "ET"].join("\n")
      : "";
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/**
 * Builds a PDF of images only, like a scanned document: each page of `makePdf(pages)` is
 * rendered to grayscale pixels with pdftoppm and embedded as an image, so the result has
 * no text layer. Requires pdftoppm (poppler-utils).
 */
export function makeScannedPdf(pages: string[][], dpi = 150): Uint8Array<ArrayBuffer> {
  const directory = mkdtempSync(join(tmpdir(), "docextract-scan-"));
  try {
    const source = join(directory, "source.pdf");
    writeFileSync(source, makePdf(pages));
    execFileSync("pdftoppm", ["-r", String(dpi), "-gray", source, join(directory, "page")]);
    const images = readdirSync(directory)
      .filter((name) => name.endsWith(".pgm"))
      .sort()
      .map((name) => parsePgm(readFileSync(join(directory, name))));
    return imagePdf(images);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

type GrayImage = { width: number; height: number; pixels: Buffer };

/** Parses a binary PGM (P5) image with 8-bit samples, as pdftoppm -gray writes. */
function parsePgm(file: Buffer): GrayImage {
  const header = file.subarray(0, 64).toString("latin1").match(/^P5\s+(\d+)\s+(\d+)\s+255\s/);
  if (!header) throw new Error("not an 8-bit binary PGM");
  const width = Number(header[1]);
  const height = Number(header[2]);
  return { width, height, pixels: file.subarray(header[0].length, header[0].length + width * height) };
}

/** A PDF with one US Letter page per image, each image scaled to fill its page. */
function imagePdf(images: GrayImage[]): Uint8Array<ArrayBuffer> {
  const objects: Buffer[] = [];
  const pageIds = images.map((_, i) => 3 + i * 3);
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((image, i) => {
    const [pageId, contentId, imageId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const content = "q 612 0 0 792 0 0 cm /Im1 Do Q";
    const data = deflateSync(image.pixels);
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects[contentId] = Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects[imageId] = Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
      ),
      data,
      Buffer.from("\nendstream"),
    ]);
  });

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let length = parts[0].length;
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    const part = Buffer.concat([Buffer.from(`${id} 0 obj\n`), objects[id], Buffer.from("\nendobj\n")]);
    parts.push(part);
    length += part.length;
  }
  let trailer = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) trailer += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(trailer));
  const out = Buffer.concat(parts);
  return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length) as ArrayBuffer);
}
