/**
 * Floating rich-text toolbar for the canvas text node card.
 *
 * Layout (left → right): text color · P/H1/H2/H3 · Bold/Italic/Underline/Strike
 * · lists · quote · divider · clear formatting · link.
 *
 * Commands are applied to the native contenteditable selection via the editor
 * handle (`execCommand`); the editor parses the DOM back into the document
 * model afterwards. Labels are hardcoded Chinese, consistent with the canvas workspace.
 */
import { memo } from 'react';
import {
  Bold,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Strikethrough,
  Underline,
  X,
} from 'lucide-react';
import type { TextEditorHandle } from '@/canvas/text-editor';
import { TEXT_COLOR_TOKENS, type TextColorToken } from '@/domain/text-document';
import { resolveTextColorCss } from '@/canvas/text-styles';
import {
  NODE_TOOLBAR_BUTTON,
  NODE_TOOLBAR_BUTTON_ACTIVE,
  NODE_TOOLBAR_SURFACE,
} from '@/canvas/node-control-styles';

export interface TextToolbarState {
  blockType: string;
  blockLevel?: 1 | 2 | 3;
  marks: { bold: boolean; italic: boolean; underline: boolean; strike: boolean };
  linkActive: boolean;
  colorToken: TextColorToken | null;
}

interface TextToolbarProps {
  editorRef: React.RefObject<TextEditorHandle | null>;
  state: TextToolbarState;
  disabled: boolean;
  textColor: string | null;
  onTextColorChange: (token: TextColorToken | null) => void;
  onBlockTypeChange: (type: string, level?: 1 | 2 | 3) => void;
  onOpenLink: () => void;
  onClose: () => void;
}

const BLOCK_TYPES: Array<{ type: string; level?: 1 | 2 | 3; label: string }> = [
  { type: 'paragraph', label: 'P' },
  { type: 'heading', level: 1, label: 'H1' },
  { type: 'heading', level: 2, label: 'H2' },
  { type: 'heading', level: 3, label: 'H3' },
];

const BLOCK_TITLES: Record<string, string> = {
  p: '普通段落',
  h1: '一级标题',
  h2: '二级标题',
  h3: '三级标题',
};

export const TextToolbar = memo(function TextToolbar({
  editorRef,
  state,
  disabled,
  textColor,
  onTextColorChange,
  onBlockTypeChange,
  onOpenLink,
  onClose,
}: TextToolbarProps) {
  const run = (command: string, value?: string) => {
    if (disabled) {
      return;
    }
    editorRef.current?.execCommand(command, value);
  };

  const currentBlock = (() => {
    if (state.blockType === 'heading') {
      return BLOCK_TYPES.find((item) => item.type === 'heading' && item.level === state.blockLevel)
        ?? BLOCK_TYPES[0];
    }
    return BLOCK_TYPES.find((item) => item.type === state.blockType) ?? BLOCK_TYPES[0];
  })();

  return (
    <div className={NODE_TOOLBAR_SURFACE}>
      {/* Text color */}
      <button
        type="button"
        disabled={disabled}
        title="文本颜色"
        className={NODE_TOOLBAR_BUTTON}
        onClick={() => {
          const currentIndex = textColor ? TEXT_COLOR_TOKENS.indexOf(textColor as TextColorToken) : -1;
          const next = TEXT_COLOR_TOKENS[(currentIndex + 1) % TEXT_COLOR_TOKENS.length];
          onTextColorChange(next === 'default' ? null : next);
        }}
      >
        <Palette
          className="h-3.5 w-3.5"
          strokeWidth={2.2}
          style={textColor ? { color: resolveTextColorCss(textColor as TextColorToken) } : undefined}
        />
      </button>

      <Divider />

      {/* Block types */}
      {BLOCK_TYPES.map((item) => {
        const active = currentBlock === item;
        return (
          <button
            key={item.label}
            type="button"
            disabled={disabled}
            title={BLOCK_TITLES[item.label.toLowerCase()] ?? item.label}
            className={`${NODE_TOOLBAR_BUTTON} ${active ? NODE_TOOLBAR_BUTTON_ACTIVE : ''}`}
            onClick={() => onBlockTypeChange(item.type, item.level)}
          >
            {item.label}
          </button>
        );
      })}

      <Divider />

      {/* Marks */}
      <ToolbarButton disabled={disabled} active={state.marks.bold} title="加粗" onClick={() => run('bold')}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={state.marks.italic} title="斜体" onClick={() => run('italic')}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={state.marks.underline} title="下划线" onClick={() => run('underline')}>
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={state.marks.strike} title="删除线" onClick={() => run('strikeThrough')}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Lists / quote */}
      <ToolbarButton disabled={disabled} active={state.blockType === 'bulletList'} title="无序列表" onClick={() => onBlockTypeChange('bulletList')}>
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={state.blockType === 'orderedList'} title="有序列表" onClick={() => onBlockTypeChange('orderedList')}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={state.blockType === 'blockquote'} title="引用" onClick={() => onBlockTypeChange('blockquote')}>
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Divider / clear formatting */}
      <ToolbarButton
        disabled={disabled}
        title="分割线"
        onClick={() => {
          if (disabled) {
            return;
          }
          editorRef.current?.execCommand('insertDivider');
        }}
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled}
        title="清除格式"
        onClick={() => {
          if (disabled) {
            return;
          }
          editorRef.current?.execCommand('removeFormat');
        }}
      >
        <Highlighter className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Link */}
      <ToolbarButton disabled={disabled} active={state.linkActive} title="链接" onClick={onOpenLink}>
        <Link className="h-3.5 w-3.5" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton disabled={false} title="完成" onClick={onClose}>
        <X className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
});

function ToolbarButton({
  disabled,
  active,
  title,
  onClick,
  children,
}: {
  disabled: boolean;
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`${NODE_TOOLBAR_BUTTON} ${active ? NODE_TOOLBAR_BUTTON_ACTIVE : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-white/14" aria-hidden="true" />;
}
