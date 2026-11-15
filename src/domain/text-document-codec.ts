/**
 * Codec between the structured `TextDocument` and the legacy plain/Markdown
 * `content` string (double-read / double-write compatibility).
 *
 * - `documentToContent` renders a lossy but faithful Markdown-ish mirror so old
 *   consumers and old readers never break.
 * - `contentToDocument` parses legacy Markdown into a structured document on
 *   load; unparseable text is preserved verbatim (never silently dropped).
 */
import {
  type TextBlock,
  type TextDocument,
  createEmptyTextDocument,
} from '@/domain/text-document';

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]{}()#+\-.!|>])/g, '\\$1');
}

function blockToMarkdown(block: TextBlock): string {
  if (block.type === 'divider') {
    return '---';
  }
  if (block.type === 'code') {
    return `\`\`\`\n${block.text}\n\`\`\``;
  }
  if (block.type === 'heading') {
    const level = block.level ?? 1;
    const prefix = '#'.repeat(Math.min(3, Math.max(1, level)));
    return `${prefix} ${block.text}`;
  }
  if (block.type === 'bulletList') {
    return `- ${block.text}`;
  }
  if (block.type === 'orderedList') {
    return `1. ${block.text}`;
  }
  if (block.type === 'blockquote') {
    return `> ${block.text}`;
  }
  return block.text;
}

/** Render a TextDocument as a Markdown-ish string (compatible `content` mirror). */
export function documentToContent(input: TextDocument): string {
  if (!input || !Array.isArray(input.blocks)) {
    return '';
  }
  return input.blocks
    .filter((block) => block && typeof block.text === 'string')
    .map(blockToMarkdown)
    .join('\n\n');
}

function stripMarkdownSyntax(raw: string, marker: string): string {
  const trimmed = raw.trim();
  if (marker && trimmed.startsWith(marker)) {
    return trimmed.slice(marker.length).trim();
  }
  return raw;
}

/** Parse a legacy Markdown-ish content string into a structured TextDocument. */
export function contentToDocument(content: string, generateBlockId: () => string): TextDocument {
  const document = createEmptyTextDocument();
  const blocks: TextBlock[] = [];
  const rawLines = (content ?? '').split(/\r?\n/);
  let codeBuffer: string[] | null = null;

  const flushCode = () => {
    if (codeBuffer) {
      blocks.push({
        id: generateBlockId(),
        type: 'code',
        text: codeBuffer.join('\n'),
      });
      codeBuffer = null;
    }
  };

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (codeBuffer !== null) {
      if (line.trim() === '```') {
        flushCode();
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushCode();
      codeBuffer = [];
      continue;
    }
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      flushCode();
      blocks.push({ id: generateBlockId(), type: 'divider', text: '' });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushCode();
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ id: generateBlockId(), type: 'heading', level, text: heading[2] });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushCode();
      blocks.push({
        id: generateBlockId(),
        type: 'bulletList',
        text: stripMarkdownSyntax(line, line.trim().match(/^[-*+]/)?.[0] ?? ''),
      });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushCode();
      blocks.push({
        id: generateBlockId(),
        type: 'orderedList',
        text: stripMarkdownSyntax(line, line.trim().match(/^\d+[.)]/)?.[0] ?? ''),
      });
      continue;
    }
    if (line.trim().startsWith('> ')) {
      flushCode();
      blocks.push({
        id: generateBlockId(),
        type: 'blockquote',
        text: stripMarkdownSyntax(line, '>'),
      });
      continue;
    }
    if (line.trim() === '') {
      continue;
    }
    flushCode();
    // Inline markdown markers are kept as plain text in the legacy parse (the
    // editor starts from clean structured blocks; marks are applied via the
    // toolbar). The text is unescaped from the mirror encoding.
    const unescaped = line.replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1');
    blocks.push({ id: generateBlockId(), type: 'paragraph', text: unescaped });
  }
  flushCode();

  document.blocks = blocks;
  return document;
}

/** Escape all markdown-meaningful characters in a single-line block text. */
export function escapeInlineText(text: string): string {
  return escapeMarkdown(text);
}
