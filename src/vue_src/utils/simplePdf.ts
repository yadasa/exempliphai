function toAsciiSafe(s: string): string {
  // PDF built below is ASCII-only (Type1 Helvetica). Replace non-ASCII with space.
  return String(s || '').replace(/[\u0080-\uFFFF]/g, ' ');
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(s: string, maxChars: number): string[] {
  const t = String(s || '');
  if (!t) return [''];
  if (!maxChars || t.length <= maxChars) return [t];

  const out: string[] = [];
  let cur = t;
  while (cur.length > maxChars) {
    // Prefer breaking on spaces.
    let cut = cur.lastIndexOf(' ', maxChars);
    if (cut < Math.floor(maxChars * 0.6)) cut = maxChars;
    out.push(cur.slice(0, cut).trimEnd());
    cur = cur.slice(cut).trimStart();
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function isHeadingLine(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return false;
  // Common resume headings.
  if (/^(summary|skills|experience|work experience|education|projects|certifications|certification|leadership|volunteer|awards)$/i.test(t)) return true;
  // All-caps short lines often used as headings.
  if (t.length <= 28 && t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  // Lines ending with ':' are often section labels.
  if (t.length <= 40 && /:$/.test(t)) return true;
  return false;
}

export function simplePdfFromText(text: string, { maxLines = 62 } = {}): Uint8Array {
  const raw = toAsciiSafe(text || '');
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  // Wrap long lines for a cleaner ATS PDF.
  const wrapped: string[] = [];
  for (const l of lines) {
    const w = wrapLine(l, 92);
    wrapped.push(...w);
  }

  const clipped = wrapped.slice(0, maxLines);

  // Basic text stream
  const fontSize = 10;
  const left = 50; // slightly wider margins
  const top = 770;
  const leading = 12;

  let stream = 'BT\n';
  stream += `/F1 ${fontSize} Tf\n`;
  stream += `${left} ${top} Td\n`;

  let prevWasBlank = false;
  for (let i = 0; i < clipped.length; i++) {
    const rawLine = clipped[i] || '';
    const lineTrim = String(rawLine).trim();
    const isBlank = !lineTrim;
    const heading = isHeadingLine(lineTrim);

    // Extra spacing between sections (but compress multiple blank lines).
    if (isBlank) {
      if (prevWasBlank) continue;
      prevWasBlank = true;
      stream += `() Tj\n`;
      stream += `0 -${leading} Td\n`;
      continue;
    }
    prevWasBlank = false;

    // Bold-ish headings via Helvetica-Bold.
    if (heading) {
      stream += `/F2 ${fontSize + 0.5} Tf\n`;
    } else {
      stream += `/F1 ${fontSize} Tf\n`;
    }

    const escaped = pdfEscape(rawLine);
    stream += `(${escaped}) Tj\n`;

    if (i !== clipped.length - 1) stream += `0 -${leading} Td\n`;
  }

  stream += '\nET\n';

  const header = '%PDF-1.3\n';

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);

  // Build xref
  let body = '';
  const offsets: number[] = [0]; // object 0
  let pos = header.length;

  for (const obj of objects) {
    offsets.push(pos);
    body += obj;
    pos += obj.length;
  }

  const xrefStart = header.length + body.length;

  const size = offsets.length;
  let xref = `xref\n0 ${size}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    const off = offsets[i];
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const pdf = header + body + xref + trailer;
  return new TextEncoder().encode(pdf);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
      a.remove();
    } catch (_) {}
  }, 250);
}
