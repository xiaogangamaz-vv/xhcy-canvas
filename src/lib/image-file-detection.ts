/**
 * Image recognition for pasted and selected files.
 *
 * Clipboard images from chat apps and screenshot tools frequently arrive with an
 * empty MIME type, and a pasted file may also carry a name with no extension.
 * The declared type is trusted first, then the file name, then the leading bytes,
 * so a file that really is an image is not dropped for missing metadata.
 *
 * This decides whether to *attempt* an upload. It is not a content gate: a
 * non-image renamed to `.png` passes the name check, and a later host-side check remains the authority on what may be stored.
 */
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i

/** Brand values of the ISO base media file format that denote an image. */
const ISO_IMAGE_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "msf1", "avif", "avis",
])

function readByte(head: Uint8Array, index: number): number {
  return head.length > index ? head[index] : -1
}

function matchesImageSignature(head: Uint8Array): boolean {
  // PNG
  if (readByte(head, 0) === 0x89 && readByte(head, 1) === 0x50 && readByte(head, 2) === 0x4e && readByte(head, 3) === 0x47) return true
  // JPEG
  if (readByte(head, 0) === 0xff && readByte(head, 1) === 0xd8 && readByte(head, 2) === 0xff) return true
  // GIF
  if (readByte(head, 0) === 0x47 && readByte(head, 1) === 0x49 && readByte(head, 2) === 0x46) return true
  // RIFF....WEBP
  if (readByte(head, 0) === 0x52 && readByte(head, 1) === 0x49 && readByte(head, 2) === 0x46 && readByte(head, 3) === 0x46
    && readByte(head, 8) === 0x57 && readByte(head, 9) === 0x45 && readByte(head, 10) === 0x42 && readByte(head, 11) === 0x50) return true
  // BMP
  if (readByte(head, 0) === 0x42 && readByte(head, 1) === 0x4d) return true
  // ISO base media file format. The "ftyp" box alone is not enough — an mp4 or
  // mov carries the same shape — so the major brand has to name an image.
  if (readByte(head, 4) === 0x66 && readByte(head, 5) === 0x74 && readByte(head, 6) === 0x79 && readByte(head, 7) === 0x70) {
    return ISO_IMAGE_BRANDS.has(String.fromCharCode(...head.slice(8, 12)))
  }
  return false
}

export function hasImageMimeType(file: { type?: string } | null | undefined): boolean {
  return typeof file?.type === "string" && file.type.toLowerCase().startsWith("image/")
}

export function hasImageExtension(name: string | null | undefined): boolean {
  return IMAGE_EXTENSION.test(String(name || ""))
}

export async function sniffImageSignature(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    return matchesImageSignature(head)
  } catch {
    return false
  }
}

export async function isRecognizableImageFile(file: File | null | undefined): Promise<boolean> {
  if (!file || typeof file.size !== "number" || file.size <= 0) return false
  if (hasImageMimeType(file)) return true
  if (hasImageExtension(file.name)) return true
  return sniffImageSignature(file)
}

export async function filterRecognizableImageFiles(files: readonly File[]): Promise<File[]> {
  const recognized = await Promise.all(files.map(file => isRecognizableImageFile(file)))
  return files.filter((_, index) => recognized[index])
}
