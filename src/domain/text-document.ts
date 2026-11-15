/**
 * Structured rich-text document model for `textAnnotationNode`.
 *
 * The document is the single source of truth for rich text. The legacy
 * `content` string on `TextAnnotationNodeData` is kept as a compatible mirror
 * (double-write), and old projects with only `content` are migrated into a
 * `TextDocument` on load (see `textDocumentMigration.ts`).
 *
 * Design rules (from the text-node development plan):
 * - no raw HTML is trusted input; HTML is only produced at render time
 * - selection / toolbar / fullscreen state never enters the document
 * - blocks carry stable ids so codec/migration can diff and repair
 * - links are stored as ranges with an href, mentions as stable reference ids
 */
export type TextBlockType =
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'code'
  | 'divider';

export type TextMark = 'bold' | 'italic' | 'underline' | 'strike';

export interface TextMarkRange {
  from: number;
  to: number;
  marks: TextMark[];
}

export interface TextLinkRange {
  from: number;
  to: number;
  href: string;
}

export interface TextMentionRange {
  from: number;
  to: number;
  nodeId: string;
  label: string;
}

export interface TextBlock {
  id: string;
  type: TextBlockType;
  text: string;
  level?: 1 | 2 | 3;
  marks?: TextMarkRange[];
  hrefs?: TextLinkRange[];
  mentions?: TextMentionRange[];
  textColor?: string | null;
  textAlign?: 'left' | 'center' | 'right';
}

export interface TextDocument {
  version: 1;
  blocks: TextBlock[];
}

export const TEXT_DOCUMENT_VERSION = 1;

/** Theme-controlled text color token ids (rendered via CSS variables). */
export type TextColorToken =
  | 'default'
  | 'primary'
  | 'muted'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export const TEXT_COLOR_TOKENS: readonly TextColorToken[] = [
  'default',
  'primary',
  'muted',
  'accent',
  'success',
  'warning',
  'danger',
];

/** Per-node rich-text editing display defaults (session-agnostic). */
export interface TextNodeDisplayDefaults {
  editorMode: 'plain' | 'rich';
  textColor: TextColorToken | null;
  defaultBlockType: TextBlockType;
  fontSize: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
}

export const TEXT_NODE_DISPLAY_DEFAULTS: TextNodeDisplayDefaults = {
  editorMode: 'rich',
  textColor: null,
  defaultBlockType: 'paragraph',
  fontSize: 14,
  lineHeight: 1.6,
  textAlign: 'left',
};

export function createEmptyTextDocument(): TextDocument {
  return {
    version: TEXT_DOCUMENT_VERSION,
    blocks: [],
  };
}

export function isTextDocument(value: unknown): value is TextDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<TextDocument>;
  if (candidate.version !== TEXT_DOCUMENT_VERSION || !Array.isArray(candidate.blocks)) {
    return false;
  }
  return candidate.blocks.every(
    (block) =>
      block &&
      typeof block === 'object' &&
      typeof block.id === 'string' &&
      typeof block.text === 'string' &&
      typeof block.type === 'string'
  );
}
