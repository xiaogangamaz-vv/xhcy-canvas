/**
 * Minimal unified token mapping for the canvas text node (mirrors the
 * Storyboard-Copilot textNodeStyles). Text nodes share the canvas gray tokens;
 * only theme-controlled text color tokens are exposed.
 */
import type { TextColorToken } from '@/domain/text-document';

export function resolveTextColorCss(token: TextColorToken | null): string {
  switch (token) {
    case 'primary':
      return 'var(--text-primary, rgba(231,237,243,0.92))';
    case 'muted':
      return 'var(--text-secondary, rgba(170,180,191,0.7))';
    case 'accent':
      return 'var(--accent-violet-strong, #8b7cf6)';
    case 'success':
      return 'var(--success, #34d399)';
    case 'warning':
      return 'var(--warning, #fbbf24)';
    case 'danger':
      return 'var(--danger, #f87171)';
    case 'default':
    case null:
      return 'inherit';
    default:
      return 'inherit';
  }
}
