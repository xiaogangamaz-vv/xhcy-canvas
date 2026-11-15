import { hasImageExtension, hasImageMimeType } from "@/lib/image-file-detection"

export type ClipboardImageItemLike = {
  kind: string
  type: string
  getAsFile: () => File | null
}

export type ClipboardImageSelection = {
  files: File[]
  overflowCount: number
  totalImageCount: number
}

/**
 * Names a clipboard gives an image it carries itself, as opposed to a file the user picked:
 * Windows apps offer one picture in several formats (a PNG stream plus a bitmap), and the
 * browser names each of those "image.<ext>".
 */
const CLIPBOARD_GENERIC_IMAGE_NAME = /^(image|blob|clipboard|untitled)(\.[a-z0-9]+)?$/i

function isGenericClipboardImageName(name: string): boolean {
  return String(name || "").trim() === "" || CLIPBOARD_GENERIC_IMAGE_NAME.test(String(name).trim())
}

/** Prefer a lossless, widely supported encoding when one picture arrives in several formats. */
function clipboardImageFormatRank(file: File): number {
  switch (String(file.type || "").toLowerCase()) {
    case "image/png": return 0
    case "image/webp": return 1
    case "image/jpeg": return 2
    case "image/gif": return 3
    case "image/bmp": return 4
    case "image/tiff": return 5
    default: return 6
  }
}

/**
 * True when two clipboard files are the same picture.
 *
 * An exact repeat (same name, size and type) is never intentional. The same picture in two
 * encodings (a PNG and a bitmap, both auto-named by the clipboard) is what Windows apps put
 * on the clipboard for a single copied image, and it used to be added twice — which is what
 * "paste one picture, get two" looked like. A real multi-image paste keeps its own file names
 * and one shared type, so it is never collapsed here.
 */
function isSameClipboardImage(a: File, b: File): boolean {
  if (a.size === b.size && String(a.type) === String(b.type) && String(a.name) === String(b.name)) return true
  const aType = String(a.type || "").toLowerCase()
  const bType = String(b.type || "").toLowerCase()
  return aType !== bType
    && isGenericClipboardImageName(a.name)
    && isGenericClipboardImageName(b.name)
}

/**
 * Collapses the duplicate representations of one pasted picture, keeping the best encoding.
 * Multi-image pastes pass through untouched.
 */
export function dedupeClipboardImageFiles(files: readonly File[]): File[] {
  const unique: File[] = []
  for (const file of files) {
    const index = unique.findIndex(existing => isSameClipboardImage(existing, file))
    if (index < 0) {
      unique.push(file)
      continue
    }
    if (clipboardImageFormatRank(file) < clipboardImageFormatRank(unique[index])) unique[index] = file
  }
  return unique
}

export function clipboardImageFiles(
  items: Iterable<ClipboardImageItemLike> | ArrayLike<ClipboardImageItemLike>,
  remainingCapacity: number,
): ClipboardImageSelection {
  if (!Number.isInteger(remainingCapacity)) throw new Error("剩余容量必须是整数")
  if (remainingCapacity < 0) throw new Error("剩余容量不能小于 0")

  const imageFiles: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (!file) continue
    // Images copied out of chat apps and screenshot tools routinely report an
    // empty MIME type. Rejecting those here dropped the whole paste silently,
    // before any upload was attempted. A declared non-image type is still
    // refused; an empty type falls through to the byte-level check that
    // isRecognizableImageFile performs further down the upload path.
    if (!hasImageMimeType(file) && String(file.type || "").trim() !== "" && !hasImageExtension(file.name)) continue
    imageFiles.push(file)
  }

  const uniqueFiles = dedupeClipboardImageFiles(imageFiles)
  return {
    files: uniqueFiles.slice(0, remainingCapacity),
    overflowCount: Math.max(0, uniqueFiles.length - remainingCapacity),
    totalImageCount: uniqueFiles.length,
  }
}

export async function readClipboardImageFiles(remainingCapacity: number): Promise<ClipboardImageSelection> {
  if (!Number.isInteger(remainingCapacity)) throw new Error("剩余容量必须是整数")
  if (remainingCapacity < 0) throw new Error("剩余容量不能小于 0")
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    return { files: [], overflowCount: 0, totalImageCount: 0 }
  }

  const items = await navigator.clipboard.read()
  const imageFiles: File[] = []
  for (const item of items) {
    // Prefer an explicitly typed image representation; fall back to any
    // representation so an image whose type the source app left blank is not
    // discarded before the byte-level check can see it.
    const type = item.types.find(candidate => candidate.toLowerCase().startsWith("image/"))
      || item.types.find(candidate => String(candidate || "").trim() === "")
    if (!type) continue
    const blob = await item.getType(type)
    if (!hasImageMimeType(blob) && String(blob.type || "").trim() !== "" && !hasImageExtension(blob.type)) continue
    const extension = hasImageMimeType(blob) ? blob.type.split("/")[1] || "png" : "png"
    imageFiles.push(new File([blob], `pasted-image.${extension}`, { type: hasImageMimeType(blob) ? blob.type : "" }))
  }

  const uniqueFiles = dedupeClipboardImageFiles(imageFiles)
  return {
    files: uniqueFiles.slice(0, remainingCapacity),
    overflowCount: Math.max(0, uniqueFiles.length - remainingCapacity),
    totalImageCount: uniqueFiles.length,
  }
}
