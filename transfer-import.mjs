// Text is extracted locally. PDF content is data, never executable instructions.
export async function extractTransferPdfLines(data) {
  const pdfjs = await import('./assets/vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  const doc = await task.promise;
  const lines = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let line = null;
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        if (!line || Math.abs(line.y - y) > 3) {
          line = { text: '', font: item.fontName, y, page: number };
          lines.push(line);
        }
        line.text += (line.text ? ' ' : '') + item.str;
      }
    }
    return lines.map(line => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }));
  } finally { await task.destroy(); }
}

const positionPattern = /\s(QB|RB|FB|WR|TE|OL|OT|OG|C|DL|DE|DT|LB|ILB|OLB|CB|DB|FS|SS|S|K|P)(?=\s|[-–—]|$)/;
const headerPattern = /^(.*?)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s+((?:RS\s*)?(?:FR|SO|JR|SR)\s+)?(\d)\s*(?:years?|yrs?)\s+left\s*[-–—:]\s*(.*)$/i;

function parseHeader(text, schools) {
  const m = text.match(headerPattern);
  if (!m) return null;
  let identity = m[1].trim();
  let grade = (m[4] || '').trim().toUpperCase();
  // Some exports place grade before OVR/POT.
  identity = identity.replace(/\s+((?:RS\s*)?(?:FR|SO|JR|SR))$/i, (_, value) => { grade = value.toUpperCase(); return ''; });
  const position = identity.match(positionPattern);
  if (!position) throw new Error('Position could not be read: ' + text);
  const before = identity.slice(0, position.index).trim();
  const after = identity.slice(position.index + position[0].length).replace(/^\s*[-–—]\s*/, '').trim();
  let name = before, transferFrom = after;
  if (!after) {
    const school = [...schools].sort((a,b) => b.length - a.length).find(value => before.toLowerCase().endsWith(' ' + value.toLowerCase()));
    if (!school) throw new Error('Team/name order could not be read: ' + text + '. Put position before the school name.');
    name = before.slice(0, -school.length).trim();
    transferFrom = school;
  }
  if (!name || !transferFrom) throw new Error('Missing name or school: ' + text);
  return { name, position: position[1], transferFrom, overall: Number(m[2]), potential: Number(m[3]), rating: m[2] + '/' + m[3], grade, yearsLeft: Number(m[5]), brokenPromise: m[6].trim(), prompt: '', offerMode: 'pitch', values: {}, stars: null, hometown: '', storyline: '' };
}

export function parseTransferLines(lines, schools = []) {
  const rows = [];
  let current = null, inPrompt = false, headerFont = '';
  for (const line of lines) {
    const text = String(line.text || '').trim();
    if (!text || /^\d+$/.test(text)) continue;
    const header = parseHeader(text, schools);
    if (header) {
      current = { ...header, sourceOrder: rows.length };
      rows.push(current); inPrompt = false; headerFont = line.font;
      continue;
    }
    if (/\d\s*\/\s*\d.*\b(?:years?|yrs?)\b.*\bleft\b/i.test(text)) throw new Error('Unrecognized player header: ' + text);
    if (!current) continue;
    // Wrapped broken promises retain the header font and start as continuations.
    // Bold narrative paragraphs must not be mistaken for a continued header.
    const startsName = current.name.split(/\s+/).some(part => text.toLowerCase().startsWith(part.toLowerCase() + ' ') || text.toLowerCase().startsWith(part.toLowerCase() + '’') || text.toLowerCase().startsWith(part.toLowerCase() + "'"));
    const continuation = !inPrompt && !startsName && line.font === headerFont && /^(?:[a-z\d]|Freshman\b|Sophomore\b|Junior\b|Senior\b)/.test(text);
    if (continuation) current.brokenPromise += ' ' + text;
    else { inPrompt = true; current.prompt += (current.prompt ? ' ' : '') + text; }
  }
  if (!rows.length) throw new Error('No transfer players found. Use the original text PDF, not a scanned image.');
  for (const row of rows) {
    if (!row.prompt || !row.brokenPromise) throw new Error('Missing prompt or broken promise for ' + row.name + '. Check the PDF before importing.');
  }
  // Rank is only a stable import ID; transfers are never assigned star tiers.
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
