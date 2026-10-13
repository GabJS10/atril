/** One page of a generated test PDF: the boxes and rotation that decide its viewport. */
export type PageBoxes = {
  mediaBox: [number, number, number, number];
  cropBox?: [number, number, number, number];
  rotate?: number;
  userUnit?: number;
};

/**
 * A PDF with empty pages (nothing is drawn) whose only content is the page boxes, rotation and user unit, for tests
 * of the viewport matrix. Generated here, so no book is needed.
 */
export function pageBoxesPdf(pages: PageBoxes[]): Uint8Array {
  const objects: string[] = [];
  const firstPage = 3;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${firstPage + i} 0 R`).join(" ")}] >>`,
  );
  for (const page of pages) {
    const entries = [
      "/Type /Page /Parent 2 0 R",
      `/MediaBox [${page.mediaBox.join(" ")}]`,
      page.cropBox ? `/CropBox [${page.cropBox.join(" ")}]` : "",
      page.rotate ? `/Rotate ${page.rotate}` : "",
      page.userUnit ? `/UserUnit ${page.userUnit}` : "",
    ];
    objects.push(`<< ${entries.filter(Boolean).join(" ")} >>`);
  }

  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(body, (char) => char.charCodeAt(0));
}
