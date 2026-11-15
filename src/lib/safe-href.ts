/**
 * 允许渲染成链接的 href 白名单。
 *
 * 为什么需要：href 可能来自**粘贴的 HTML**（编辑器会把 <a href> 解析进文档模型），
 * 而这类内容不经过链接输入框的校验。`javascript:` 会被浏览器当成脚本执行，
 * `data:` 同样能承载脚本，所以只放行 http / https / mailto 与站内绝对路径。
 *
 * 先去掉控制字符与空白：`java\tscript:alert(1)` 在浏览器里仍是 `javascript:`，
 * 但按字符串前缀判断会漏掉。返回 null 表示调用方应降级成纯文本。
 *
 */
export function safeHref(rawHref: unknown): string | null {
  const href = String(rawHref ?? "").trim().replace(/[\u0000-\u001F\u007F\s]+/g, "")
  if (!href) return null
  // 站内绝对路径；`//host/path` 是协议相对 URL，会跳到外站，不接受。
  if (href.startsWith("/") && !href.startsWith("//")) return href
  try {
    const parsed = new URL(href)
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}
