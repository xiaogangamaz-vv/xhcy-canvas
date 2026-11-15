/**
 * The 16:9 media block shared by the scene and character cards.
 *
 * Both cards show "the media chosen for this node", so the markup, loading
 * attributes and frame live here once instead of drifting between renderers.
 */
export type CanvasNodeMediaPreviewProps = {
  mediaUrl: string
  mediaKind: string
}

export function CanvasNodeMediaPreview({ mediaUrl, mediaKind }: CanvasNodeMediaPreviewProps) {
  const trimmedMedia = mediaUrl.trim()
  if (!trimmedMedia) return null

  return (
    <div className="w-full shrink-0 overflow-hidden rounded-md bg-black/40">
      {mediaKind.trim() === "video" ? (
        <video
          src={trimmedMedia}
          controls
          preload="metadata"
          className="aspect-video w-full rounded-md bg-black object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trimmedMedia}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-video w-full rounded-md object-contain"
        />
      )}
    </div>
  )
}
