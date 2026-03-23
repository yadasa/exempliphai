function toAsciiSafe(s: string): string {
  // PDF built below is ASCII-only (Type1 Helvetica). Replace non-ASCII with space.
  return String(s || '').replace(/[\u0080-\uFFFF]/g, ' ');
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function simplePdfFromText(text: string, { maxLines = 58 } = {}): Uint8Array {
  const raw = toAsciiSafe(text || '');
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  const clipped = lines.slice(0, maxLines);

  // Basic text stream
  const fontSize = 10;
  const left = 54; // 0.75 inch
  const top = 760;
  const leading = 12;

  let stream = 'BT\n';
  stream += `/F1 ${fontSize} Tf\n`;
  stream += `${left} ${top} Td\n`;

  for (let i = 0; i < clipped.length; i++) {
    const line = pdfEscape(clipped[i] || '');
    stream += `(${line}) Tj\n`;
    if (i !== clipped.length - 1) stream += `0 -${leading} Td\n`;
  }

  stream += '\nET\n';

  const header = '%PDF-1.3\n';

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
  );
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
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

  let xref = 'xref\n0 6\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    const off = offsets[i];
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

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
