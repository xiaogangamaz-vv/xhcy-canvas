/**
 * Pure command handlers for the rich-text document.
 *
 * Commands operate on `TextDocument` blocks (immutably) and are fully
 * testable; the contenteditable editor only translates DOM selection into
 * block/offset coordinates and back, keeping DOM queries out of command logic.
 *
 * Text offsets are UTF-16 code-unit offsets into `block.text` (consistent with
 * DOM text node offsets), so codec and DOM agree on `from`/`to` ranges.
 */
import {
  type TextBlock,
  type TextBlockType,
  type TextDocument,
  type TextMark,
  type TextMarkRange,
  createEmptyTextDocument,
} from '@/domain/text-document';

export interface TextSelectionRange {
  blockIndex: number;
  from: number;
  to: number;
}

export interface TextEditResult {
  document: TextDocument;
  /** True when the command actually changed the document (undo step). */
  changed: boolean;
  /** Block index to place the cursor into after the command. */
  cursorBlockIndex?: number;
  cursorOffset?: number;
}

function cloneBlock(block: TextBlock): TextBlock {
  return {
    ...block,
    marks: block.marks ? block.marks.map((range) => ({ ...range, marks: [...range.marks] })) : undefined,
    hrefs: block.hrefs ? block.hrefs.map((range) => ({ ...range })) : undefined,
    mentions: block.mentions ? block.mentions.map((range) => ({ ...range })) : undefined,
  };
}

function cloneDocument(document: TextDocument): TextDocument {
  return {
    version: document.version,
    blocks: document.blocks.map(cloneBlock),
  };
}

function ensureBlock(document: TextDocument, index: number): { document: TextDocument; index: number } {
  if (index >= 0 && index < document.blocks.length) {
    return { document, index };
  }
  const next = cloneDocument(document);
  next.blocks.push({ id: `tb-${Date.now().toString(36)}-${next.blocks.length}`, type: 'paragraph', text: '' });
  return { document: next, index: next.blocks.length - 1 };
}

function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function applyMarkToRange(
  block: TextBlock,
  mark: TextMark,
  from: number,
  to: number
): { marks: TextMarkRange[] | undefined; changed: boolean } {
  const existing = block.marks ?? [];
  const normalizedFrom = Math.min(from, to);
  const normalizedTo = Math.max(from, to);
  if (normalizedFrom >= normalizedTo) {
    return { marks: block.marks, changed: false };
  }

  const next: TextMarkRange[] = [];
  let changed = false;
  let markActiveInSelection = false;

  for (const range of existing) {
    if (overlaps(range.from, range.to, normalizedFrom, normalizedTo)) {
      if (range.marks.includes(mark)) {
        markActiveInSelection = true;
      }
      // Split the existing range around the selection.
      if (range.from < normalizedFrom) {
        next.push({ from: range.from, to: normalizedFrom, marks: [...range.marks] });
      }
      const inSelectionMarks = range.marks.filter((m) => m !== mark);
      if (normalizedFrom < normalizedTo && inSelectionMarks.length > 0) {
        next.push({ from: normalizedFrom, to: normalizedTo, marks: inSelectionMarks });
      }
      if (range.to > normalizedTo) {
        next.push({ from: normalizedTo, to: range.to, marks: [...range.marks] });
      }
      changed = true;
    } else {
      next.push({ ...range, marks: [...range.marks] });
    }
  }

  if (!markActiveInSelection) {
    next.push({ from: normalizedFrom, to: normalizedTo, marks: [mark] });
    changed = true;
  }

  // Merge adjacent ranges with identical mark sets.
  const merged: TextMarkRange[] = [];
  for (const range of next.sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (
      last
      && last.to === range.from
      && last.marks.length === range.marks.length
      && last.marks.every((markItem, index) => markItem === range.marks[index])
    ) {
      last.to = range.to;
    } else {
      merged.push({ ...range, marks: [...range.marks] });
    }
  }

  return { marks: merged, changed };
}

/** Toggle a mark (bold/italic/underline/strike) over the selection. */
export function toggleMark(
  document: TextDocument,
  selection: TextSelectionRange,
  mark: TextMark
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const block = prepared.blocks[index];
  const from = Math.min(Math.max(0, selection.from), block.text.length);
  const to = Math.min(Math.max(from, selection.to), block.text.length);

  const { marks, changed } = applyMarkToRange(block, mark, from, to);
  const next = cloneDocument(prepared);
  next.blocks[index] = { ...next.blocks[index], marks };
  return { document: next, changed, cursorBlockIndex: index, cursorOffset: to };
}

function hasMarkInSelection(block: TextBlock, mark: TextMark, from: number, to: number): boolean {
  for (const range of block.marks ?? []) {
    if (overlaps(range.from, range.to, from, to) && range.marks.includes(mark)) {
      return true;
    }
  }
  return false;
}

/** Whether the mark is active over the whole selection (toolbar state). */
export function isMarkActive(document: TextDocument, selection: TextSelectionRange, mark: TextMark): boolean {
  const block = document.blocks[selection.blockIndex];
  if (!block) {
    return false;
  }
  const from = Math.min(Math.max(0, selection.from), block.text.length);
  const to = Math.min(Math.max(from, selection.to), block.text.length);
  return hasMarkInSelection(block, mark, from, to);
}

/** Set the block type of the current block (paragraph/heading/list/quote/code). */
export function setBlockType(
  document: TextDocument,
  selection: TextSelectionRange,
  type: TextBlockType,
  level?: 1 | 2 | 3
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const block = prepared.blocks[index];
  if (block.type === type && (type !== 'heading' || block.level === level)) {
    return { document: prepared, changed: false, cursorBlockIndex: index };
  }
  const next = cloneDocument(prepared);
  const currentBlock = next.blocks[index];
  if (type === 'heading') {
    next.blocks[index] = { ...currentBlock, type, level: level ?? 1 };
  } else {
    next.blocks[index] = { ...currentBlock, type, level: undefined };
  }
  return { document: next, changed: true, cursorBlockIndex: index };
}

/** Insert a divider block after the current block. */
export function insertDivider(
  document: TextDocument,
  selection: TextSelectionRange
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const next = cloneDocument(prepared);
  const divider: TextBlock = {
    id: `tb-div-${Date.now().toString(36)}-${index}`,
    type: 'divider',
    text: '',
  };
  next.blocks.splice(index + 1, 0, divider);
  return { document: next, changed: true, cursorBlockIndex: index + 1, cursorOffset: 0 };
}

/** Clear formatting: remove marks, links, mentions and reset block type to paragraph. */
export function clearFormatting(
  document: TextDocument,
  selection: TextSelectionRange
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const block = prepared.blocks[index];
  const from = Math.min(Math.max(0, selection.from), block.text.length);
  const to = Math.min(Math.max(from, selection.to), block.text.length);

  const next = cloneDocument(prepared);
  const current = next.blocks[index];
  const hasSelection = to > from;

  const marks = (current.marks ?? [])
    .flatMap((range) => {
      const pieces: TextMarkRange[] = [];
      if (range.from < from) {
        pieces.push({ from: range.from, to: Math.min(range.to, from), marks: [...range.marks] });
      }
      if (range.to > to) {
        pieces.push({ from: Math.max(range.from, to), to: range.to, marks: [...range.marks] });
      }
      return pieces;
    })
    .filter((range) => range.from < range.to);
  const hrefs = (current.hrefs ?? []).filter((range) => !overlaps(range.from, range.to, from, to));
  const mentions = (current.mentions ?? []).filter((range) => !overlaps(range.from, range.to, from, to));

  const changed = hasSelection
    ? JSON.stringify(current.marks ?? []) !== JSON.stringify(marks)
      || (current.hrefs ?? []).length !== hrefs.length
      || (current.mentions ?? []).length !== mentions.length
    : current.type !== 'paragraph';

  next.blocks[index] = {
    ...current,
    type: 'paragraph',
    level: undefined,
    marks,
    hrefs,
    mentions,
    textColor: hasSelection ? current.textColor : null,
  };
  return { document: next, changed, cursorBlockIndex: index, cursorOffset: hasSelection ? from : selection.to };
}

/** Set a link over the selection; href '' removes the link. */
export function setLink(
  document: TextDocument,
  selection: TextSelectionRange,
  href: string
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const block = prepared.blocks[index];
  const from = Math.min(Math.max(0, selection.from), block.text.length);
  const to = Math.min(Math.max(from, selection.to), block.text.length);

  const next = cloneDocument(prepared);
  const current = next.blocks[index];
  const existing = current.hrefs ?? [];
  if (from >= to) {
    return { document: prepared, changed: false, cursorBlockIndex: index, cursorOffset: from };
  }
  const filtered = existing.filter((range) => !overlaps(range.from, range.to, from, to));
  const hrefs = href.trim() ? [...filtered, { from, to, href: href.trim() }] : filtered;
  next.blocks[index] = { ...current, hrefs };
  return { document: next, changed: true, cursorBlockIndex: index, cursorOffset: to };
}

/** Get the href of a link covering the cursor ('' when none). */
export function linkAtCursor(document: TextDocument, selection: TextSelectionRange): string {
  const block = document.blocks[selection.blockIndex];
  if (!block) {
    return '';
  }
  const from = selection.from;
  const to = selection.to;
  for (const range of block.hrefs ?? []) {
    if (from > range.from || to < range.to) {
      continue;
    }
    if (from >= range.from && to <= range.to) {
      return range.href;
    }
    if (to === from && from >= range.from && from <= range.to) {
      return range.href;
    }
  }
  return '';
}

/** Insert a mention reference (stable node id + display label snapshot). */
export function insertMention(
  document: TextDocument,
  selection: TextSelectionRange,
  nodeId: string,
  label: string,
  insertAt: 'cursor' | 'end' = 'cursor'
): TextEditResult {
  const { document: prepared, index } = ensureBlock(document, selection.blockIndex);
  const next = cloneDocument(prepared);
  const current = next.blocks[index];
  const text = current.text;
  const position = insertAt === 'cursor'
    ? Math.min(Math.max(0, selection.to), text.length)
    : text.length;
  const insertedText = `@${label} `;
  const newText = text.slice(0, position) + insertedText + text.slice(position);

  const shift = (offset: number): number => (offset > position ? offset + insertedText.length : offset);
  const marks = (current.marks ?? []).map((range) => ({
    ...range,
    from: shift(range.from),
    to: shift(range.to),
    marks: [...range.marks],
  }));
  const hrefs = (current.hrefs ?? []).map((range) => ({ ...range, from: shift(range.from), to: shift(range.to) }));
  const mentions = (current.mentions ?? []).map((range) => ({
    ...range,
    from: shift(range.from),
    to: shift(range.to),
    nodeId: range.nodeId,
    label: range.label,
  }));
  mentions.push({
    from: position,
    to: position + insertedText.length,
    nodeId,
    label,
  });

  next.blocks[index] = { ...current, text: newText, marks, hrefs, mentions };
  return {
    document: next,
    changed: true,
    cursorBlockIndex: index,
    cursorOffset: position + insertedText.length,
  };
}

/** Find a mention covering a cursor position (for invalid-reference rendering). */
export function mentionAtCursor(
  document: TextDocument,
  selection: TextSelectionRange
): { nodeId: string; label: string } | null {
  const block = document.blocks[selection.blockIndex];
  if (!block) {
    return null;
  }
  for (const range of block.mentions ?? []) {
    if (selection.to >= range.from && selection.to <= range.to) {
      return { nodeId: range.nodeId, label: range.label };
    }
  }
  return null;
}

/** Build an empty paragraph document with one block. */
export function createSingleParagraphDocument(text = ''): TextDocument {
  const document = createEmptyTextDocument();
  document.blocks.push({
    id: `tb-${Date.now().toString(36)}-0`,
    type: 'paragraph',
    text,
  });
  return document;
}
