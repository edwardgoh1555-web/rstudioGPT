/**
 * Document Chunker Service
 * 
 * Turns messy source materials (PPT / PDF / DOCX / CSV / MD / images / email / TXT)
 * into a searchable corpus of normalised chunks with:
 *   - stable IDs + anchors (deterministic citing / retrieval)
 *   - consistent metadata (source + chunk)
 *   - lightweight structure extraction (headings / bullets / tables / entities / numbers)
 *   - content suitable for downstream retrieval + evidence-ledger creation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Format-specific extractors — lazy-loaded to avoid DOMMatrix / browser-API
// errors when the module is required at Electron startup
let mammoth, pdfjsLib, PizZip, XLSX, csvParse;
function lazyMammoth()  { if (!mammoth)  mammoth  = require('mammoth');  return mammoth; }
function lazyPdfjs() {
    if (!pdfjsLib) {
        pdfjsLib = require('pdfjs-dist');
        // Disable the web-worker entirely so pdfjs-dist never calls import().
        // Electron patches import() which breaks the default relative worker
        // path.  Running on the main thread is fine for server-side extraction.
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        console.log('[Chunker] pdfjs-dist loaded (worker disabled, main-thread mode)');
    }
    return pdfjsLib;
}
function lazyPizZip()   { if (!PizZip)   PizZip   = require('pizzip');    return PizZip; }
function lazyXLSX()     { if (!XLSX)     XLSX     = require('xlsx');      return XLSX; }
function lazyCsvParse() { if (!csvParse) csvParse = require('csv-parse/sync').parse; return csvParse; }

// ─────────────────────────────────
// Constants
// ─────────────────────────────────
const CHUNK_TARGET_TOKENS = 512;      // ~380 words
const CHUNK_OVERLAP_TOKENS = 64;      // small overlap for context continuity
const APPROX_CHARS_PER_TOKEN = 4;
const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;

const SUPPORTED_EXTENSIONS = new Set([
    '.pptx', '.pdf', '.docx', '.doc',
    '.xlsx', '.xls', '.csv',
    '.md', '.txt', '.rtf',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
    '.eml', '.msg',
    '.html', '.htm',
    '.json'
]);

// ─────────────────────────────────
// Chunk schema
// ─────────────────────────────────
function makeChunkId(sourceId, chunkIndex, content) {
    const hash = crypto.createHash('sha256')
        .update(`${sourceId}::${chunkIndex}::${content.slice(0, 200)}`)
        .digest('hex')
        .slice(0, 12);
    return `chunk_${hash}`;
}

function makeSourceId(filePath, fileName) {
    const hash = crypto.createHash('sha256')
        .update(`${fileName}::${fs.statSync(filePath).size}`)
        .digest('hex')
        .slice(0, 10);
    return `src_${hash}`;
}

// ─────────────────────────────────
// Structure extraction helpers
// ─────────────────────────────────
function extractStructure(text) {
    const headings = [];
    const bullets = [];
    const tables = [];
    const entities = [];
    const numbers = [];

    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Headings: markdown-style or ALL-CAPS short lines
        if (/^#{1,6}\s+/.test(trimmed)) {
            headings.push(trimmed.replace(/^#+\s*/, ''));
        } else if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed)) {
            headings.push(trimmed);
        }

        // Bullets
        if (/^[\u2022\u2023\u25E6\u2043\-\*]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed)) {
            bullets.push(trimmed.replace(/^[\u2022\u2023\u25E6\u2043\-\*\d\.\)]+\s*/, ''));
        }

        // Numbers with context  ($, %, B/M/K, years)
        const numMatches = trimmed.match(/(?:\$[\d,.]+[BMKbmk]?|\d+(?:\.\d+)?%|\d{4}|\d+(?:,\d{3})+(?:\.\d+)?)/g);
        if (numMatches) {
            for (const n of numMatches) numbers.push(n);
        }
    }

    // Entities: simple capitalized multi-word phrases (name-like)
    const entityRegex = /(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})(?=[\s,.\-;:!?]|$)/g;
    let m;
    const entitySet = new Set();
    while ((m = entityRegex.exec(text)) !== null) {
        const candidate = m[1].trim();
        if (candidate.split(/\s+/).length >= 2 && candidate.length > 5) {
            entitySet.add(candidate);
        }
    }
    entities.push(...[...entitySet].slice(0, 30));

    return {
        headings: [...new Set(headings)].slice(0, 20),
        bullets: bullets.slice(0, 50),
        tables,
        entities,
        numbers: [...new Set(numbers)].slice(0, 40)
    };
}

// ─────────────────────────────────
// Text chunking
// ─────────────────────────────────
function chunkText(text, sectionHints = []) {
    if (!text || text.trim().length === 0) return [];

    // Try to split on section boundaries first
    const sections = splitOnSections(text, sectionHints);
    const rawChunks = [];

    for (const section of sections) {
        if (section.text.length <= CHUNK_TARGET_CHARS) {
            rawChunks.push(section);
        } else {
            // Sub-chunk large sections with paragraph-aware splitting
            const subChunks = splitLargeSection(section.text, section.anchor);
            for (const sc of subChunks) {
                rawChunks.push({ ...section, ...sc });
            }
        }
    }

    return rawChunks;
}

function splitOnSections(text, sectionHints) {
    // Split by double-newline (paragraph boundaries) first
    const paragraphs = text.split(/\n{2,}/);
    if (paragraphs.length <= 1 && text.length <= CHUNK_TARGET_CHARS) {
        return [{ text: text.trim(), anchor: sectionHints[0] || 'full', sectionTitle: null }];
    }

    const sections = [];
    let buffer = '';
    let currentAnchor = sectionHints[0] || 'para:1';
    let paraIdx = 0;

    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        paraIdx++;

        if (buffer.length + trimmed.length + 2 > CHUNK_TARGET_CHARS && buffer.length > 0) {
            sections.push({
                text: buffer.trim(),
                anchor: currentAnchor,
                sectionTitle: extractSectionTitle(buffer)
            });
            // Keep overlap
            const overlapStart = Math.max(0, buffer.length - CHUNK_OVERLAP_CHARS);
            buffer = buffer.slice(overlapStart) + '\n\n' + trimmed;
            currentAnchor = `para:${paraIdx}`;
        } else {
            buffer += (buffer ? '\n\n' : '') + trimmed;
        }
    }
    if (buffer.trim()) {
        sections.push({
            text: buffer.trim(),
            anchor: currentAnchor,
            sectionTitle: extractSectionTitle(buffer)
        });
    }

    return sections;
}

function splitLargeSection(text, baseAnchor) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
    const chunks = [];
    let buffer = '';
    let subIdx = 0;

    for (const sentence of sentences) {
        if (buffer.length + sentence.length > CHUNK_TARGET_CHARS && buffer.length > 0) {
            chunks.push({
                text: buffer.trim(),
                anchor: `${baseAnchor}:sub${subIdx}`
            });
            const overlapStart = Math.max(0, buffer.length - CHUNK_OVERLAP_CHARS);
            buffer = buffer.slice(overlapStart) + sentence;
            subIdx++;
        } else {
            buffer += sentence;
        }
    }
    if (buffer.trim()) {
        chunks.push({
            text: buffer.trim(),
            anchor: `${baseAnchor}:sub${subIdx}`
        });
    }
    return chunks;
}

function extractSectionTitle(text) {
    const first = text.split('\n')[0]?.trim();
    if (!first) return null;
    if (/^#{1,6}\s+/.test(first)) return first.replace(/^#+\s*/, '');
    if (first.length < 80 && first === first.toUpperCase() && /[A-Z]{3,}/.test(first)) return first;
    return null;
}

// ═════════════════════════════════
// Format-specific extractors
// ═════════════════════════════════

/**
 * PPTX Extractor — uses PizZip to read slide XML
 */
async function extractPptx(filePath) {
    const buffer = fs.readFileSync(filePath);
    const zip = new (lazyPizZip())(buffer);
    const sections = [];
    let slideNum = 0;

    // Iterate through slide files in the zip
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)/)[1]);
            const nb = parseInt(b.match(/slide(\d+)/)[1]);
            return na - nb;
        });

    for (const slideFile of slideFiles) {
        slideNum++;
        const xml = zip.file(slideFile).asText();
        // Extract text from <a:t> tags
        const textMatches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        const texts = textMatches.map(m => m.replace(/<\/?a:t>/g, '').trim()).filter(Boolean);

        if (texts.length > 0) {
            sections.push({
                text: texts.join('\n'),
                anchor: `slide:${slideNum}`,
                sectionTitle: texts[0]?.length < 80 ? texts[0] : null,
                metadata: { slideNumber: slideNum }
            });
        }
    }
    return { sections, formatMeta: { slideCount: slideNum } };
}

/**
 * PDF Extractor — uses pdfjs-dist directly with worker disabled.
 * This avoids all Electron import() patching issues since no web-worker
 * is spawned; parsing runs on the main Node thread.
 */
async function extractPdf(filePath) {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    console.log(`[Chunker] Extracting PDF: ${fileName} (${buffer.length} bytes)`);

    // ── Primary path: pdfjs-dist (no worker) ──
    try {
        const pdfjs = lazyPdfjs();
        const data = new Uint8Array(buffer);
        const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
        const sections = [];

        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const tc = await page.getTextContent();
            // Reconstruct text preserving line breaks via transform y-coords
            let lastY = null;
            const parts = [];
            for (const item of tc.items) {
                if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
                    parts.push('\n');
                }
                parts.push(item.str);
                lastY = item.transform[5];
            }
            const text = parts.join('').trim();
            if (text.length < 5) continue;
            sections.push({
                text,
                anchor: `page:${i}`,
                sectionTitle: extractSectionTitle(text),
                metadata: { pageNumber: i }
            });
        }

        let info = {};
        try { const meta = await doc.getMetadata(); info = meta?.info || {}; } catch { }
        await doc.destroy();

        console.log(`[Chunker] PDF OK (pdfjs-direct): ${sections.length} sections from ${doc.numPages} pages`);
        return {
            sections: sections.length > 0
                ? sections
                : [{ text: '', anchor: 'full', sectionTitle: null, metadata: {} }],
            formatMeta: { pageCount: doc.numPages, info }
        };
    } catch (pdfJsErr) {
        console.warn(`[Chunker] pdfjs-dist failed for ${fileName}: ${pdfJsErr.message} — trying raw extraction`);
    }

    // ── Fallback: raw-bytes text extraction ──
    const rawText = extractPdfRawText(buffer);
    if (rawText.length > 20) {
        console.log(`[Chunker] PDF OK (raw): ${rawText.length} chars extracted from ${fileName}`);
        return {
            sections: [{ text: rawText, anchor: 'full', sectionTitle: null, metadata: {} }],
            formatMeta: { pageCount: null, info: {}, method: 'raw' }
        };
    }
    throw new Error('PDF extraction failed: both pdfjs and raw methods produced no text');
}

/**
 * Raw PDF text extraction fallback.
 * Decompresses Flate-encoded streams and pulls text from BT...ET blocks.
 * Not perfect for every PDF but handles most machine-generated reports.
 */
function extractPdfRawText(buffer) {
    const zlib = require('zlib');
    const chunks = [];
    let pos = 0;
    const buf = Buffer.from(buffer);

    // Find and decompress all FlateDecode streams
    while (pos < buf.length) {
        const streamStart = buf.indexOf('stream\n', pos);
        if (streamStart === -1) break;
        const dataStart = streamStart + 7; // length of 'stream\n'
        // Also handle 'stream\r\n'
        let actualStart = dataStart;
        if (buf[streamStart + 6] === 0x0D && buf[streamStart + 7] === 0x0A) {
            actualStart = streamStart + 8;
        }
        const streamEnd = buf.indexOf('endstream', actualStart);
        if (streamEnd === -1) break;

        const raw = buf.slice(actualStart, streamEnd);
        // Try to decompress (most PDF content streams are FlateDecode)
        try {
            const inflated = zlib.inflateSync(raw);
            chunks.push(inflated.toString('latin1'));
        } catch {
            // Not compressed or different encoding — try as-is
            const asStr = raw.toString('latin1');
            if (/\(.*\)/.test(asStr) || /Tj|TJ/.test(asStr)) {
                chunks.push(asStr);
            }
        }
        pos = streamEnd + 9;
    }

    // Extract text from PostScript text operators
    const textParts = [];
    for (const chunk of chunks) {
        // BT ... ET blocks contain text operators
        const btRegex = /BT\s([\s\S]*?)\sET/g;
        let m;
        while ((m = btRegex.exec(chunk)) !== null) {
            const block = m[1];
            // Tj operator: (text) Tj
            const tjRegex = /\(([^)]*?)\)\s*Tj/g;
            let tm;
            while ((tm = tjRegex.exec(block)) !== null) {
                textParts.push(decodePdfString(tm[1]));
            }
            // TJ operator: [(text) num (text) ...] TJ
            const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
            while ((tm = tjArrayRegex.exec(block)) !== null) {
                const inner = tm[1];
                const strRegex = /\(([^)]*?)\)/g;
                let sm;
                while ((sm = strRegex.exec(inner)) !== null) {
                    textParts.push(decodePdfString(sm[1]));
                }
            }
            // ' operator (move to next line and show text)
            const quoteRegex = /\(([^)]*?)\)\s*'/g;
            while ((tm = quoteRegex.exec(block)) !== null) {
                textParts.push(decodePdfString(tm[1]));
            }
        }
    }

    return textParts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Decode PDF escape sequences (\n, \r, \t, octal) */
function decodePdfString(s) {
    return s.replace(/\\([nrtbf\\()]|[0-7]{1,3})/g, (_, c) => {
        switch (c) {
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case 'b': return '\b';
            case 'f': return '\f';
            case '\\': return '\\';
            case '(': return '(';
            case ')': return ')';
            default: return String.fromCharCode(parseInt(c, 8));
        }
    });
}

/**
 * DOCX Extractor — uses mammoth
 */
async function extractDocx(filePath) {
    const buffer = fs.readFileSync(filePath);
    const mm = lazyMammoth();
    const result = await mm.extractRawText({ buffer });
    const text = result.value;
    
    // Also get HTML for structure hints
    const htmlResult = await mm.convertToHtml({ buffer });
    const headings = [];
    const hMatches = htmlResult.value.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) || [];
    for (const h of hMatches) {
        headings.push(h.replace(/<[^>]+>/g, '').trim());
    }

    // Split by headings if possible
    const sections = [];
    if (headings.length > 0) {
        let remaining = text;
        for (let i = 0; i < headings.length; i++) {
            const heading = headings[i];
            const idx = remaining.indexOf(heading);
            if (idx > 0) {
                const before = remaining.slice(0, idx).trim();
                if (before) {
                    sections.push({
                        text: before,
                        anchor: `section:${sections.length + 1}`,
                        sectionTitle: sections.length === 0 ? 'Preamble' : null,
                        metadata: {}
                    });
                }
                remaining = remaining.slice(idx);
            }
        }
        if (remaining.trim()) {
            sections.push({
                text: remaining.trim(),
                anchor: `section:${sections.length + 1}`,
                sectionTitle: headings[headings.length - 1] || null,
                metadata: {}
            });
        }
    }

    if (sections.length === 0) {
        sections.push({ text, anchor: 'full', sectionTitle: null, metadata: {} });
    }
    return { sections, formatMeta: { headings } };
}

/**
 * Markdown Extractor — direct text, split on headings
 */
async function extractMarkdown(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const sections = [];
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    let lastIdx = 0;
    let sectionNum = 0;
    let m;

    while ((m = headingRegex.exec(text)) !== null) {
        if (m.index > lastIdx) {
            const chunk = text.slice(lastIdx, m.index).trim();
            if (chunk) {
                sections.push({
                    text: chunk,
                    anchor: `section:${sectionNum || 'preamble'}`,
                    sectionTitle: sectionNum === 0 ? 'Preamble' : null,
                    metadata: {}
                });
            }
        }
        sectionNum++;
        lastIdx = m.index;
    }
    if (lastIdx < text.length) {
        sections.push({
            text: text.slice(lastIdx).trim(),
            anchor: `section:${sectionNum || 1}`,
            sectionTitle: null,
            metadata: {}
        });
    }
    if (sections.length === 0) {
        sections.push({ text, anchor: 'full', sectionTitle: null, metadata: {} });
    }
    return { sections, formatMeta: {} };
}

/**
 * Excel Extractor — uses xlsx, treats each sheet as a section
 */
async function extractExcel(filePath) {
    const xl = lazyXLSX();
    const workbook = xl.readFile(filePath);
    const sections = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        // Convert to CSV text for readability
        const csv = xl.utils.sheet_to_csv(sheet);
        if (csv.trim().length < 5) continue;

        // Also get JSON for structure
        const json = xl.utils.sheet_to_json(sheet, { defval: '' });
        const headers = json.length > 0 ? Object.keys(json[0]) : [];

        sections.push({
            text: csv,
            anchor: `sheet:${sheetName}`,
            sectionTitle: sheetName,
            metadata: { sheetName, rowCount: json.length, headers },
            contentType: 'table'
        });
    }
    return { sections, formatMeta: { sheetCount: workbook.SheetNames.length } };
}

/**
 * CSV Extractor
 */
async function extractCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let records;
    try {
        records = lazyCsvParse()(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
    } catch {
        // Fall back to plain text
        return { sections: [{ text: raw, anchor: 'full', sectionTitle: null, metadata: {}, contentType: 'table' }], formatMeta: {} };
    }
    const headers = records.length > 0 ? Object.keys(records[0]) : [];
    return {
        sections: [{
            text: raw,
            anchor: 'full',
            sectionTitle: null,
            metadata: { rowCount: records.length, headers },
            contentType: 'table'
        }],
        formatMeta: { rowCount: records.length, headers }
    };
}

/**
 * Plain Text / RTF Extractor
 */
async function extractPlainText(filePath) {
    let text = fs.readFileSync(filePath, 'utf8');
    // Strip RTF control words if present
    if (text.startsWith('{\\rtf')) {
        text = text.replace(/\{\\[^{}]*\}/g, '').replace(/\\[a-z]+\d*\s?/gi, '').replace(/[{}]/g, '');
    }
    return { sections: [{ text: text.trim(), anchor: 'full', sectionTitle: null, metadata: {} }], formatMeta: {} };
}

/**
 * HTML Extractor — strip tags, keep structure
 */
async function extractHtml(filePath) {
    const html = fs.readFileSync(filePath, 'utf8');
    // Strip scripts and styles
    let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '');
    // Convert block elements to newlines
    clean = clean.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
                 .replace(/<br\s*\/?>/gi, '\n')
                 .replace(/<[^>]+>/g, '')
                 .replace(/&nbsp;/gi, ' ')
                 .replace(/&amp;/gi, '&')
                 .replace(/&lt;/gi, '<')
                 .replace(/&gt;/gi, '>')
                 .replace(/\n{3,}/g, '\n\n');
    return { sections: [{ text: clean.trim(), anchor: 'full', sectionTitle: null, metadata: {} }], formatMeta: {} };
}

/**
 * JSON Extractor — pretty-print and extract text values
 */
async function extractJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let obj;
    try { obj = JSON.parse(raw); } catch { return extractPlainText(filePath); }
    const pretty = JSON.stringify(obj, null, 2);
    return {
        sections: [{ text: pretty, anchor: 'full', sectionTitle: null, metadata: { type: 'json' }, contentType: 'structured' }],
        formatMeta: {}
    };
}

/**
 * Email (.eml) Extractor — parses headers + body
 */
async function extractEmail(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const headerEnd = raw.indexOf('\r\n\r\n') !== -1 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
    const headers = raw.slice(0, headerEnd);
    const body = raw.slice(headerEnd).trim();

    // Parse key headers
    const from = (headers.match(/^From:\s*(.+)$/mi) || [])[1] || '';
    const to = (headers.match(/^To:\s*(.+)$/mi) || [])[1] || '';
    const subject = (headers.match(/^Subject:\s*(.+)$/mi) || [])[1] || '';
    const date = (headers.match(/^Date:\s*(.+)$/mi) || [])[1] || '';

    const text = `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
    return {
        sections: [{ text, anchor: 'full', sectionTitle: subject || null, metadata: { from, to, subject, date } }],
        formatMeta: { type: 'email' }
    };
}

/**
 * Image Extractor — uses OpenAI Vision API to describe the image
 */
async function extractImage(filePath, openaiApiKey) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
    const mime = mimeMap[ext] || 'image/png';
    const base64 = fs.readFileSync(filePath).toString('base64');

    if (!openaiApiKey) {
        return {
            sections: [{ text: '[Image — no OpenAI key available for vision extraction]', anchor: 'full', sectionTitle: null, metadata: {}, contentType: 'image_description' }],
            formatMeta: { type: 'image' }
        };
    }

    try {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey: openaiApiKey });

        const response = await client.chat.completions.create({
            model: 'gpt-5.2',
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Describe this image in detail for a business analyst. Extract all text, data, charts, org-chart relationships, logos, and key information visible. Format as structured notes with headings.'
                    },
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' }
                    }
                ]
            }],
            max_tokens: 1500
        });

        const description = response.choices[0]?.message?.content || '[No description generated]';
        return {
            sections: [{ text: description, anchor: 'full', sectionTitle: 'Image Analysis', metadata: {}, contentType: 'image_description' }],
            formatMeta: { type: 'image', visionModel: 'gpt-5.2' }
        };
    } catch (error) {
        console.error('[Chunker] Vision extraction failed:', error.message);
        return {
            sections: [{ text: `[Image extraction failed: ${error.message}]`, anchor: 'full', sectionTitle: null, metadata: {}, contentType: 'image_description' }],
            formatMeta: { type: 'image', error: error.message }
        };
    }
}

// ═════════════════════════════════
// Main extraction router
// ═════════════════════════════════
async function extractDocument(filePath, fileName, options = {}) {
    const ext = path.extname(fileName).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported file type: ${ext}`);
    }

    let result;
    switch (ext) {
        case '.pptx':
            result = await extractPptx(filePath);
            break;
        case '.pdf':
            result = await extractPdf(filePath);
            break;
        case '.docx':
        case '.doc':
            result = await extractDocx(filePath);
            break;
        case '.md':
            result = await extractMarkdown(filePath);
            break;
        case '.xlsx':
        case '.xls':
            result = await extractExcel(filePath);
            break;
        case '.csv':
            result = await extractCsv(filePath);
            break;
        case '.txt':
        case '.rtf':
            result = await extractPlainText(filePath);
            break;
        case '.html':
        case '.htm':
            result = await extractHtml(filePath);
            break;
        case '.json':
            result = await extractJson(filePath);
            break;
        case '.eml':
        case '.msg':
            result = await extractEmail(filePath);
            break;
        case '.jpg':
        case '.jpeg':
        case '.png':
        case '.gif':
        case '.bmp':
        case '.webp':
            result = await extractImage(filePath, options.openaiApiKey);
            break;
        default:
            result = await extractPlainText(filePath);
    }

    return result;
}

// ═════════════════════════════════
// Public API
// ═════════════════════════════════

/**
 * Process a single document into normalised chunks
 * @param {string} filePath  Absolute path to the file on disk
 * @param {string} fileName  Original file name (with extension)
 * @param {object} options   { openaiApiKey }
 * @returns {object}  { sourceId, sourceName, sourceType, chunks[], formatMeta }
 */
async function processDocument(filePath, fileName, options = {}) {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const sourceId = makeSourceId(filePath, fileName);

    // 1. Extract raw sections
    const { sections, formatMeta } = await extractDocument(filePath, fileName, options);

    // 2. Chunk each section
    const allChunks = [];
    let globalIdx = 0;

    for (const section of sections) {
        const subChunks = chunkText(section.text, [section.anchor]);

        for (const sc of subChunks) {
            const content = sc.text;
            const structure = extractStructure(content);
            const chunkId = makeChunkId(sourceId, globalIdx, content);

            allChunks.push({
                id: chunkId,
                sourceId,
                sourceName: fileName,
                sourceType: ext,
                anchor: sc.anchor || section.anchor,
                chunkIndex: globalIdx,
                totalChunks: -1, // filled in after loop
                content,
                contentType: section.contentType || 'text',
                structure,
                metadata: {
                    ...(section.metadata || {}),
                    sectionTitle: sc.sectionTitle || section.sectionTitle,
                    wordCount: content.split(/\s+/).length,
                    charCount: content.length
                }
            });
            globalIdx++;
        }
    }

    // Back-fill totalChunks
    for (const c of allChunks) c.totalChunks = allChunks.length;

    return {
        sourceId,
        sourceName: fileName,
        sourceType: ext,
        chunks: allChunks,
        formatMeta,
        processedAt: new Date().toISOString()
    };
}

/**
 * Process multiple documents in batch with parallel execution.
 * Uses a concurrency limit so we don't overwhelm memory with huge files.
 * @param {Array} files  Each: { filePath, fileName }
 * @param {object} options  { openaiApiKey, onProgress(current, total, fileName) }
 * @returns {object}  corpus – { documents[], totalChunks, totalDocuments }
 */
async function processDocumentBatch(files, options = {}) {
    const CONCURRENCY = 3;
    const documents = new Array(files.length).fill(null);
    let totalChunks = 0;

    console.log(`[Chunker] Processing batch of ${files.length} document(s) (concurrency: ${CONCURRENCY})`);

    for (let start = 0; start < files.length; start += CONCURRENCY) {
        const batch = files.slice(start, Math.min(start + CONCURRENCY, files.length));

        const results = await Promise.allSettled(
            batch.map(async ({ filePath, fileName }, batchIdx) => {
                const globalIdx = start + batchIdx;
                console.log(`[Chunker] [${globalIdx + 1}/${files.length}] Starting: ${fileName}`);
                options.onProgress?.(globalIdx + 1, files.length, fileName);
                return processDocument(filePath, fileName, { openaiApiKey: options.openaiApiKey });
            })
        );

        for (let j = 0; j < results.length; j++) {
            const globalIdx = start + j;
            const { filePath, fileName } = batch[j];
            const result = results[j];

            if (result.status === 'fulfilled') {
                documents[globalIdx] = result.value;
                totalChunks += result.value.chunks.length;
                console.log(`[Chunker] [${globalIdx + 1}/${files.length}] OK: ${fileName} → ${result.value.chunks.length} chunks`);
            } else {
                console.error(`[Chunker] [${globalIdx + 1}/${files.length}] FAILED: ${fileName}: ${result.reason?.message}`);
                documents[globalIdx] = {
                    sourceId: makeSourceId(filePath, fileName),
                    sourceName: fileName,
                    sourceType: path.extname(fileName).toLowerCase().replace('.', ''),
                    chunks: [],
                    formatMeta: {},
                    error: result.reason?.message || 'Unknown processing error',
                    processedAt: new Date().toISOString()
                };
            }
        }
    }

    const successCount = documents.filter(d => d && !d.error).length;
    const failCount = documents.filter(d => d && d.error).length;
    console.log(`[Chunker] Batch complete: ${successCount} succeeded, ${failCount} failed, ${totalChunks} total chunks`);

    return {
        documents,
        totalChunks,
        totalDocuments: documents.length,
        successfulDocuments: successCount,
        failedDocuments: failCount,
        processedAt: new Date().toISOString()
    };
}

/**
 * Search the corpus for chunks matching a query (simple keyword match)
 * For production you'd use embeddings, but this provides baseline retrieval
 */
function searchCorpus(corpus, query, limit = 20) {
    if (!corpus?.documents || !query) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scored = [];

    for (const doc of corpus.documents) {
        for (const chunk of (doc.chunks || [])) {
            const lower = chunk.content.toLowerCase();
            let score = 0;
            for (const term of terms) {
                const count = (lower.match(new RegExp(term, 'g')) || []).length;
                score += count;
            }
            if (score > 0) {
                scored.push({ ...chunk, _score: score });
            }
        }
    }

    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, limit);
}

module.exports = {
    processDocument,
    processDocumentBatch,
    searchCorpus,
    extractStructure,
    SUPPORTED_EXTENSIONS
};
