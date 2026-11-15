/**
 * Controlled contenteditable rich-text editor for `textAnnotationNode`.
 *
 * Architecture (per the text-node development plan):
 * - The structured `TextDocument` is the single source of truth; the DOM is a
 *   render projection (`documentToHtml`) and an input projection (`htmlToDocument`).
 * - React only re-syncs innerHTML when the serialized DOM differs from the
 *   rendered textDocument, so typing does not clobber the cursor.
 * - Toolbar formatting uses `document.execCommand` on the native contenteditable
 *   selection, then the result is parsed back into the textDocument model.
 * - IME composition is tracked so intermediate states are never committed to
 *   the history stack.
 * - Paste is sanitized to a whitelist of inline elements and block tags.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type TextBlock,
  type TextBlockType,
  type TextDocument,
  type TextMark,
} from '@/domain/text-document';
import { safeHref } from '@/lib/safe-href';

export interface TextEditorHandle {
  /** Execute a formatting command against the current native selection. */
  execCommand: (command: string, value?: string) => void;
  /** Get the current selection as block/offset coordinates. */
  getSelectionRange: () => { blockIndex: number; from: number; to: number } | null;
  /** Move the caret to a block/offset coordinate. */
  setSelectionRange: (blockIndex: number, offset: number) => void;
  focus: () => void;
  /** Trigger a synthetic input flush (used before external commands). */
  flushInput: () => void;
}

interface TextRichEditorProps {
  textDocument: TextDocument;
  placeholder: string;
  textColor: string | null;
  fontSize: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  editable: boolean;
  /** Emitted when the textDocument content changed (typed input or paste). */
  onChangeDocument: (textDocument: TextDocument, flushHistory: boolean) => void;
  onSelectionChange?: (range: { blockIndex: number; from: number; to: number } | null) => void;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyRangesToHtml(
  text: string,
  marks: TextBlock['marks'],
  hrefs: TextBlock['hrefs'],
  mentions: TextBlock['mentions']
): string {
  // Build a set of open/close markers at each offset.
  type Marker = { offset: number; open: boolean; sort: number; html: string };
  const markers: Marker[] = [];
  for (const range of marks ?? []) {
    if (range.from >= range.to) {
      continue;
    }
    markers.push({ offset: range.from, open: true, sort: 0, html: MARK_HTML[range.marks[0]] ?? '' });
    markers.push({ offset: range.to, open: false, sort: 0, html: MARK_HTML[range.marks[0]] ?? '' });
  }
  for (const range of hrefs ?? []) {
    if (range.from >= range.to) {
      continue;
    }
    // 粘贴进来的 <a href> 会进到文档模型里，所以渲染这一层必须过白名单：
    // 不在白名单的协议不生成链接，文字照常显示。
    const safe = safeHref(range.href);
    if (!safe) {
      continue;
    }
    markers.push({ offset: range.from, open: true, sort: 1, html: `<a href="${escapeHtml(safe)}">` });
    markers.push({ offset: range.to, open: false, sort: 1, html: '</a>' });
  }
  for (const range of mentions ?? []) {
    if (range.from >= range.to) {
      continue;
    }
    markers.push({
      offset: range.from,
      open: true,
      sort: 2,
      html: `<span data-mention="${escapeHtml(range.nodeId)}" class="text-mention">`,
    });
    markers.push({ offset: range.to, open: false, sort: 2, html: '</span>' });
  }

  markers.sort((a, b) => a.offset - b.offset || b.sort - a.sort || Number(b.open) - Number(a.open));

  let result = '';
  let cursor = 0;
  for (const marker of markers) {
    if (marker.offset < cursor) {
      continue;
    }
    result += escapeHtml(text.slice(cursor, marker.offset));
    result += marker.open ? marker.html : marker.html;
    cursor = marker.offset;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}

const MARK_HTML: Record<TextMark, string> = {
  bold: '<strong>',
  italic: '<em>',
  underline: '<u>',
  strike: '<s>',
};

function blockToHtml(block: TextBlock): string {
  if (block.type === 'divider') {
    return '<hr data-block-divider="1">';
  }
  if (block.type === 'heading') {
    const tag = `h${block.level ?? 1}` as 'h1' | 'h2' | 'h3';
    return `<${tag}>${applyRangesToHtml(block.text, block.marks, block.hrefs, block.mentions)}</${tag}>`;
  }
  if (block.type === 'bulletList') {
    return `<li>${applyRangesToHtml(block.text, block.marks, block.hrefs, block.mentions)}</li>`;
  }
  if (block.type === 'orderedList') {
    return `<li>${applyRangesToHtml(block.text, block.marks, block.hrefs, block.mentions)}</li>`;
  }
  if (block.type === 'blockquote') {
    return `<blockquote>${applyRangesToHtml(block.text, block.marks, block.hrefs, block.mentions)}</blockquote>`;
  }
  if (block.type === 'code') {
    return `<pre>${escapeHtml(block.text)}</pre>`;
  }
  return `<p>${applyRangesToHtml(block.text, block.marks, block.hrefs, block.mentions)}</p>`;
}

/** Render a TextDocument into editor HTML (single contenteditable root). */
export function documentToHtml(document: TextDocument): string {
  const inner: string[] = [];
  for (const block of document.blocks ?? []) {
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      const listTag = block.type === 'bulletList' ? 'ul' : 'ol';
      // Group consecutive same-type list blocks into one list element.
      const last = inner[inner.length - 1];
      if (last && last.startsWith(`<${listTag}`)) {
        inner[inner.length - 1] = `${last.slice(0, -`</${listTag}>`.length)}${blockToHtml(block)}</${listTag}>`;
      } else {
        inner.push(`<${listTag}>${blockToHtml(block)}</${listTag}>`);
      }
      continue;
    }
    inner.push(blockToHtml(block));
  }
  return inner.join('');
}

function textContentOf(node: Node): string {
  return node.textContent ?? '';
}

function marksOfElement(element: Element): TextMark[] {
  const marks: TextMark[] = [];
  const tag = element.tagName.toLowerCase();
  if (tag === 'strong' || tag === 'b') {
    marks.push('bold');
  }
  if (tag === 'em' || tag === 'i') {
    marks.push('italic');
  }
  if (tag === 'u') {
    marks.push('underline');
  }
  if (tag === 's' || tag === 'strike' || tag === 'del') {
    marks.push('strike');
  }
  return marks;
}

/**
 * Walk a text leaf and collect mark/link/mention ranges relative to the block
 * text. `accumulated` carries inherited formatting from ancestors.
 */
function collectRanges(
  node: Node,
  baseOffset: number,
  inheritedMarks: TextMark[],
  inheritedHref: string | null,
  inheritedMention: { nodeId: string; label: string } | null,
  out: {
    marks: Array<{ from: number; to: number; marks: TextMark[] }>;
    hrefs: Array<{ from: number; to: number; href: string }>;
    mentions: Array<{ from: number; to: number; nodeId: string; label: string }>;
  }
): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const length = node.textContent?.length ?? 0;
    if (length > 0 && (inheritedMarks.length > 0 || inheritedHref || inheritedMention)) {
      if (inheritedMarks.length > 0) {
        out.marks.push({ from: baseOffset, to: baseOffset + length, marks: [...inheritedMarks] });
      }
      if (inheritedHref) {
        out.hrefs.push({ from: baseOffset, to: baseOffset + length, href: inheritedHref });
      }
      if (inheritedMention) {
        out.mentions.push({
          from: baseOffset,
          to: baseOffset + length,
          nodeId: inheritedMention.nodeId,
          label: inheritedMention.label,
        });
      }
    }
    return length;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return 0;
  }
  const element = node as Element;
  const localMarks = [...inheritedMarks, ...marksOfElement(element)];
  let localHref = inheritedHref;
  if (element.tagName.toLowerCase() === 'a') {
    localHref = element.getAttribute('href') ?? inheritedHref;
  }
  let localMention = inheritedMention;
  if (element.hasAttribute('data-mention')) {
    localMention = {
      nodeId: element.getAttribute('data-mention') ?? '',
      label: textContentOf(element),
    };
  }

  let offset = baseOffset;
  for (const child of Array.from(element.childNodes)) {
    offset += collectRanges(child, offset, localMarks, localHref, localMention, out);
  }
  return offset - baseOffset;
}

/** Parse the editor DOM back into a structured TextDocument. */
export function htmlToDocument(root: Element, fallback: TextDocument): TextDocument {
  const blocks: TextBlock[] = [];
  let blockCounter = 0;
  const generateId = () => `tb-dom-${Date.now().toString(36)}-${blockCounter++}-${Math.random().toString(36).slice(2, 6)}`;

  const walk = (container: Element, inheritedBlock: Partial<TextBlock> | null) => {
    for (const child of Array.from(container.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text.trim().length > 0) {
          const base = inheritedBlock ?? { type: 'paragraph' as TextBlockType };
          blocks.push({
            id: generateId(),
            type: (base.type as TextBlockType) ?? 'paragraph',
            level: base.level,
            text,
          });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === 'hr' || element.hasAttribute('data-block-divider')) {
        blocks.push({ id: generateId(), type: 'divider', text: '' });
        continue;
      }
      if (tag === 'p' || tag === 'div') {
        const text = collectText(element);
        const ranges = collectRangesFromElement(element);
        blocks.push({
          id: generateId(),
          type: 'paragraph',
          text,
          marks: ranges.marks,
          hrefs: ranges.hrefs,
          mentions: ranges.mentions,
        });
        continue;
      }
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const text = collectText(element);
        const ranges = collectRangesFromElement(element);
        blocks.push({
          id: generateId(),
          type: 'heading',
          level: Number(tag.slice(1)) as 1 | 2 | 3,
          text,
          marks: ranges.marks,
          hrefs: ranges.hrefs,
          mentions: ranges.mentions,
        });
        continue;
      }
      if (tag === 'blockquote') {
        const text = collectText(element);
        const ranges = collectRangesFromElement(element);
        blocks.push({
          id: generateId(),
          type: 'blockquote',
          text,
          marks: ranges.marks,
          hrefs: ranges.hrefs,
          mentions: ranges.mentions,
        });
        continue;
      }
      if (tag === 'pre' || tag === 'code') {
        blocks.push({ id: generateId(), type: 'code', text: collectText(element) });
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(element.children)) {
          const liTag = li.tagName.toLowerCase();
          if (liTag === 'li') {
            const text = collectText(li);
            const ranges = collectRangesFromElement(li);
            blocks.push({
              id: generateId(),
              type: tag === 'ul' ? 'bulletList' : 'orderedList',
              text,
              marks: ranges.marks,
              hrefs: ranges.hrefs,
              mentions: ranges.mentions,
            });
          } else if (liTag === 'p' || liTag === 'div') {
            walk(li as HTMLElement, { type: tag === 'ul' ? 'bulletList' : 'orderedList' });
          }
        }
        continue;
      }
      // Inline formatting wrappers or unknown elements: recurse into children.
      walk(element, inheritedBlock);
    }
  };

  const collectText = (element: Element): string => element.textContent ?? '';
  const collectRangesFromElement = (element: Element) => {
    const out: {
      marks: Array<{ from: number; to: number; marks: TextMark[] }>;
      hrefs: Array<{ from: number; to: number; href: string }>;
      mentions: Array<{ from: number; to: number; nodeId: string; label: string }>;
    } = { marks: [], hrefs: [], mentions: [] };
    collectRanges(element, 0, [], null, null, out);
    return out;
  };

  walk(root, null);

  if (blocks.length === 0) {
    const legacyText = root.textContent?.trim() ?? '';
    if (legacyText) {
      blocks.push({ id: generateId(), type: 'paragraph', text: legacyText });
    }
  }

  return { version: fallback.version ?? 1, blocks };
}

function sanitizePastedHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowedTags = new Set([
    'P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL',
    'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'SPAN', 'HR',
  ]);
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!allowedTags.has(element.tagName)) {
          const text = document.createTextNode(element.textContent ?? '');
          element.replaceWith(text);
          continue;
        }
        for (const attr of Array.from(element.attributes)) {
          if (attr.name === 'href' && element.tagName === 'A') {
            continue;
          }
          element.removeAttribute(attr.name);
        }
        if (element.tagName === 'A') {
          const href = element.getAttribute('href');
          if (!href || !/^(https?:|mailto:)/i.test(href)) {
            element.removeAttribute('href');
          }
        }
        if (element.tagName === 'SPAN') {
          element.replaceWith(document.createTextNode(element.textContent ?? ''));
          continue;
        }
        walk(element);
      } else if (child.nodeType === Node.TEXT_NODE) {
        // Strip control characters.
        child.textContent = (child.textContent ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

/**
 * The editor is a single contenteditable root; block semantics are inferred
 * from the DOM on input. It does not re-render while the DOM matches the
 * textDocument (avoids cursor clobbering on every keystroke).
 */
export const TextRichEditor = forwardRef<TextEditorHandle, TextRichEditorProps>(
  function TextRichEditor(
    {
      textDocument,
      placeholder,
      textColor,
      fontSize,
      lineHeight,
      textAlign,
      editable,
      onChangeDocument,
      onSelectionChange,
      onFocusChange,
      onKeyDown,
    },
    ref
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef<string>('');
    const emitRef = useRef(onChangeDocument);
    emitRef.current = onChangeDocument;

    const html = useMemo(() => documentToHtml(textDocument), [textDocument]);

    // Sync DOM from the textDocument only when they diverge (skip while identical
    // to preserve the native caret during typing).
    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root || !editable) {
        return;
      }
      if (root.innerHTML !== html) {
        root.innerHTML = html;
      }
      lastEmittedRef.current = html;
    }, [html, editable]);

    const flushInput = useCallback(() => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const parsed = htmlToDocument(root, textDocument);
      const nextHtml = documentToHtml(parsed);
      if (nextHtml !== lastEmittedRef.current) {
        lastEmittedRef.current = nextHtml;
        emitRef.current(parsed, true);
      }
    }, [textDocument]);

    const handleInput = useCallback(() => {
      const root = rootRef.current;
      if (!root || composingRef.current) {
        return;
      }
      const parsed = htmlToDocument(root, textDocument);
      const nextHtml = documentToHtml(parsed);
      if (nextHtml === lastEmittedRef.current) {
        return;
      }
      lastEmittedRef.current = nextHtml;
      // Typed input: group into the current transaction (no history flush).
      emitRef.current(parsed, false);
    }, [textDocument]);

    const handlePaste = useCallback((event: React.ClipboardEvent) => {
      event.preventDefault();
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const clipboardHtml = event.clipboardData.getData('text/html');
      const plainText = event.clipboardData.getData('text/plain');
      const sanitized = clipboardHtml ? sanitizePastedHtml(clipboardHtml) : '';
      if (sanitized) {
        document.execCommand('insertHTML', false, sanitized);
      } else if (plainText) {
        document.execCommand('insertText', false, plainText.replace(/\r\n/g, '\n'));
      }
      // Flush after paste as a single undo step.
      setTimeout(() => {
        const parsed = htmlToDocument(root, textDocument);
        const nextHtml = documentToHtml(parsed);
        lastEmittedRef.current = nextHtml;
        emitRef.current(parsed, true);
      }, 0);
    }, [textDocument]);

    const reportSelection = useCallback(() => {
      const root = rootRef.current;
      if (!root) {
        onSelectionChange?.(null);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
        onSelectionChange?.(null);
        return;
      }
      onSelectionChange?.(selectionToBlockRange(root, textDocument));
    }, [textDocument, onSelectionChange]);

    useImperativeHandle(
      ref,
      () => ({
        execCommand(command, value) {
          flushInput();
          if (command === 'insertDivider') {
            document.execCommand('insertHorizontalRule');
          } else if (command === 'formatBlock') {
            const tag = value ? value.replace(/[<>]/g, '') : 'p';
            if (['p', 'h1', 'h2', 'h3', 'blockquote', 'pre'].includes(tag)) {
              document.execCommand('formatBlock', false, `<${tag}>`);
            }
          } else {
            document.execCommand(command, false, value);
          }
          // Apply and immediately parse back.
          setTimeout(() => {
            const root = rootRef.current;
            if (!root) {
              return;
            }
            const parsed = htmlToDocument(root, textDocument);
            const nextHtml = documentToHtml(parsed);
            lastEmittedRef.current = nextHtml;
            emitRef.current(parsed, true);
          }, 0);
        },
        getSelectionRange() {
          const root = rootRef.current;
          if (!root) {
            return null;
          }
          return selectionToBlockRange(root, textDocument);
        },
        setSelectionRange(blockIndex, offset) {
          const root = rootRef.current;
          if (!root) {
            return;
          }
          const position = blockOffsetToNodeAndOffset(root, blockIndex, offset);
          if (!position) {
            return;
          }
          const selection = window.getSelection();
          if (!selection) {
            return;
          }
          const range = document.createRange();
          range.setStart(position.node, position.offset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        },
        focus() {
          rootRef.current?.focus();
        },
        flushInput,
      }),
      [textDocument, flushInput]
    );

    return (
      <div
        ref={rootRef}
        contentEditable={editable}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck={false}
        className="canvas-text-editor-root nodrag nowheel h-full w-full overflow-auto px-1.5 py-0.5 outline-none"
        style={{
          color: textColor ?? 'var(--text-color, inherit)',
          fontSize,
          lineHeight,
          textAlign,
          minHeight: '100%',
        }}
        onInput={handleInput}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        onKeyUp={reportSelection}
        onMouseUp={reportSelection}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          flushInput();
          onFocusChange?.(false);
          if (event.currentTarget === event.target) {
            onSelectionChange?.(null);
          }
        }}
        onFocus={() => onFocusChange?.(true)}
        onClick={reportSelection}
      />
    );
  }
);

TextRichEditor.displayName = 'TextRichEditor';

/** Convert the current DOM selection into a block/offset range. */
function selectionToBlockRange(
  root: HTMLElement,
  _document: TextDocument
): { blockIndex: number; from: number; to: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const blocks = collectBlockElements(root);
  if (blocks.length === 0) {
    return null;
  }

  const anchorInfo = findBlockIndex(root, blocks, range.startContainer);
  const focusInfo = findBlockIndex(root, blocks, range.endContainer);
  if (!anchorInfo || !focusInfo) {
    return null;
  }
  const anchorBlockText = blocks[anchorInfo.blockIndex].textContent ?? '';
  const focusBlockText = blocks[focusInfo.blockIndex].textContent ?? '';
  return {
    blockIndex: anchorInfo.blockIndex,
    from: Math.min(Math.max(0, anchorInfo.offset), anchorBlockText.length),
    to: Math.min(Math.max(anchorInfo.offset, focusInfo.offset), focusBlockText.length),
  };
}

function collectBlockElements(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase();
    if (['p', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'hr'].includes(tag)) {
      blocks.push(child as HTMLElement);
    } else if (tag === 'ul' || tag === 'ol') {
      for (const li of Array.from(child.children)) {
        blocks.push(li as HTMLElement);
      }
    }
  }
  return blocks;
}

function findBlockIndex(
  root: HTMLElement,
  blocks: HTMLElement[],
  container: Node
): { blockIndex: number; offset: number } | null {
  let current: Node | null = container;
  while (current && current !== root) {
    for (let index = 0; index < blocks.length; index += 1) {
      if (blocks[index] === current) {
        return { blockIndex: index, offset: 0 };
      }
    }
    current = current.parentNode;
  }
  return null;
}

/** Map a block/offset coordinate to a DOM node + character offset. */
function blockOffsetToNodeAndOffset(
  root: HTMLElement,
  blockIndex: number,
  offset: number
): { node: Node; offset: number } | null {
  const blocks = collectBlockElements(root);
  const block = blocks[blockIndex];
  if (!block) {
    return null;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node: Node | null = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
    node = walker.nextNode();
  }
  return { node: block, offset: 0 };
}
