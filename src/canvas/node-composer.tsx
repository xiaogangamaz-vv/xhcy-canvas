/**
 * In-card parameter composer for a generation node shell.
 * Values live in a shared draft; this component mirrors them locally for typing.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, ImagePlus, Palette, X, Zap } from 'lucide-react';
import type { CanvasAsset, CanvasAssetRef } from '@/domain/types';
import type { CanvasDerivedReference } from '@/domain/edge-references';

/** 稳定的空数组，避免默认参数每次渲染都换引用导致 memo 失效。 */
const EMPTY_DERIVED_REFS: CanvasDerivedReference[] = [];
import { cn } from '@/lib/utils';
import {
  GENERATION_BTN_MUTED,
  GENERATION_BTN_PRIMARY,
  GENERATION_CHIP,
  GENERATION_CHIP_ACTIVE,
  GENERATION_COMPOSER_PANEL,
  GENERATION_COMPOSER_SURFACE_STYLE,
  GENERATION_MUTED,
  GENERATION_PILL,
  GENERATION_PILL_ACTIVE,
  GENERATION_POPOVER,
  GENERATION_POPOVER_OPTION,
  GENERATION_POPOVER_OPTION_ACTIVE,
  GENERATION_PROMPT,
} from '@/canvas/node-control-styles';

export interface CanvasNodeComposerProps {
  nodeId: string;
  /** Shared generation draft (inspectorDraft) for the selected node. */
  draft: Record<string, string>;
  /** Patch the shared draft. Values are plain strings (params passthrough). */
  onPatch: (patch: Record<string, string>) => void;
  modelOptions: Array<{ id: string; name: string }>;
  /** Model-specific aspect ratios; falls back to the built-in set when empty unless lockOptionsToCatalog. */
  aspectRatioOptions?: string[];
  /** Model-specific image sizes; falls back to the built-in set when empty unless lockOptionsToCatalog. */
  imageSizeOptions?: string[];
  /** When true, do not invent fallback sizes or ratios. */
  lockOptionsToCatalog?: boolean;
  previewOnly?: boolean;
  catalogMessage?: string | null;
  maxGenerationCount?: number;
  /** When "video", the composer shows duration and resolution instead of image size. */
  mediaType?: "image" | "video";
  resolutionOptions?: string[];
  durationOptions?: string[];
  referenceRefs: CanvasAssetRef[];
  /**
   * 从连线派生的参考图（不持久化，见 domain/canvas-edge-references.ts）。
   * 它们由连线决定，所以只能靠删连线移除，不提供就地删除按钮。
   */
  edgeReferenceRefs?: CanvasDerivedReference[];
  /** Upstream connections that cannot be used as references. */
  unusableUpstreamCount?: number;
  canvasImageAssets: CanvasAsset[];
  /** Optional video/audio refs pool (video composer). */
  canvasReferenceAssets?: CanvasAsset[];
  onToggleReference: (asset: CanvasAsset) => void;
  canRun: boolean;
  runDisabledReason: string | null;
  isGenerating: boolean;
  generationError: string | null;
  onGenerate: () => void;
  onCancel: (() => void) | undefined;
}

/** Composer config carried on node data; nodeId is supplied by the card at render time. */
export type CanvasNodeComposerConfig = Omit<CanvasNodeComposerProps, "nodeId">;

interface ComposerPreset {
  id: string;
  label: string;
}

const CAMERA_PRESETS: ComposerPreset[] = [
  { id: 'cinematic', label: '电影感' },
  { id: 'closeup', label: '特写' },
  { id: 'portrait', label: '人像' },
  { id: 'wide', label: '广角' },
  { id: 'aerial', label: '航拍' },
  { id: 'lowAngle', label: '仰拍' },
  { id: 'macro', label: '微距' },
  { id: 'ruleOfThirds', label: '三分法' },
];

const STYLE_PRESETS: ComposerPreset[] = [
  { id: 'natural', label: '自然写实' },
  { id: 'cinematic', label: '电影调色' },
  { id: 'minimalist', label: '极简' },
  { id: 'vibrant', label: '鲜艳' },
  { id: 'noir', label: '黑白电影' },
  { id: 'anime', label: '动漫' },
  { id: 'watercolor', label: '水彩' },
  { id: 'render3d', label: '3D 渲染' },
  { id: 'pixel', label: '像素风' },
];

/** Default aspect ratio and image size option sets. */
const ASPECT_RATIO_OPTIONS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21', '2:1', '1:2'] as const;
const IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'] as const;
const GENERATION_COUNTS = [1, 2, 4] as const;

const DEFAULT_MODEL_ID = 'mock-v1';

interface ComposerFields {
  prompt: string;
  modelId: string;
  cameraPreset: string | null;
  stylePreset: string | null;
  aspectRatio: string;
  imageSize: string;
  resolution: string;
  durationSeconds: string;
  generationCount: number;
}

function stringField(draft: Record<string, string>, key: string, fallback = ''): string {
  const value = draft[key];
  return typeof value === 'string' ? value : fallback;
}

function toComposerFields(draft: Record<string, string>): ComposerFields {
  const count = Number(stringField(draft, 'generationCount', '1'));
  return {
    prompt: stringField(draft, 'prompt'),
    modelId: stringField(draft, 'modelId', DEFAULT_MODEL_ID),
    cameraPreset: stringField(draft, 'cameraPreset') || null,
    stylePreset: stringField(draft, 'stylePreset') || null,
    aspectRatio: stringField(draft, 'aspectRatio', 'auto'),
    imageSize: stringField(draft, 'imageSize', '2K'),
    resolution: stringField(draft, 'resolution', '720p'),
    durationSeconds: stringField(draft, 'durationSeconds', '4'),
    generationCount: Number.isFinite(count) ? Math.min(4, Math.max(1, Math.floor(count))) : 1,
  };
}

function fieldsEqual(left: ComposerFields, right: ComposerFields): boolean {
  return left.prompt === right.prompt
    && left.modelId === right.modelId
    && left.cameraPreset === right.cameraPreset
    && left.stylePreset === right.stylePreset
    && left.aspectRatio === right.aspectRatio
    && left.imageSize === right.imageSize
    && left.resolution === right.resolution
    && left.durationSeconds === right.durationSeconds
    && left.generationCount === right.generationCount;
}

function ratioOutlineStyle(ratio: string): { width: number; height: number } {
  const [rawWidth, rawHeight] = ratio.split(':').map(Number);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const box = 18;
  if (width >= height) {
    return { width: box, height: Math.max(7, Math.round((box * height) / width)) };
  }
  return { width: Math.max(7, Math.round((box * width) / height)), height: box };
}

function presetLabel(presets: ComposerPreset[], presetId: string | null): string {
  const preset = presets.find(item => item.id === presetId);
  return preset ? preset.label : '自动';
}

function AssetThumb({ url, alt }: { url: string; alt: string }) {
  if (!url) {
    return <span className="flex h-full w-full items-center justify-center bg-surface-inset text-[9px] text-text-weak">IMG</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />;
}

interface PopoverAnchor {
  left: number;
  top: number;
}

export const CanvasNodeComposer = memo(function CanvasNodeComposer({
  nodeId: _nodeId,
  draft,
  onPatch,
  modelOptions,
  aspectRatioOptions,
  imageSizeOptions,
  mediaType = 'image',
  resolutionOptions,
  durationOptions,
  referenceRefs,
  edgeReferenceRefs = EMPTY_DERIVED_REFS,
  unusableUpstreamCount = 0,
  canvasImageAssets,
  onToggleReference,
  canRun,
  runDisabledReason,
  isGenerating,
  generationError,
  onGenerate,
  onCancel,
  lockOptionsToCatalog = false,
  previewOnly = false,
  catalogMessage = null,
  maxGenerationCount,
}: CanvasNodeComposerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cameraTriggerRef = useRef<HTMLButtonElement | null>(null);
  const styleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canvasTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ratioTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sizeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cameraPanelRef = useRef<HTMLDivElement | null>(null);
  const stylePanelRef = useRef<HTMLDivElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const modelPanelRef = useRef<HTMLDivElement | null>(null);
  const ratioPanelRef = useRef<HTMLDivElement | null>(null);
  const sizePanelRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [openPopover, setOpenPopover] = useState<'camera' | 'style' | 'canvas' | 'model' | 'ratio' | 'size' | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null);

  const [fields, setFields] = useState<ComposerFields>(() => toComposerFields(draft));

  // Sync external draft changes (Inspector edits / node re-selection) without
  // fighting local typing: only replace when the values actually differ.
  useEffect(() => {
    setFields(current => {
      const next = toComposerFields(draft);
      return fieldsEqual(current, next) ? current : next;
    });
  }, [draft]);

  const patch = (patchFields: Partial<ComposerFields>) => {
    setFields(current => ({ ...current, ...patchFields }));
    const raw: Record<string, string> = {};
    for (const [key, value] of Object.entries(patchFields)) {
      raw[key] = value === null || value === undefined ? '' : String(value);
    }
    onPatch(raw);
  };

  const count = fields.generationCount;
  const prompt = fields.prompt;

  const closePopover = () => setOpenPopover(null);

  const openPopoverFor = (
    trigger: HTMLButtonElement | null,
    kind: 'camera' | 'style' | 'canvas' | 'model' | 'ratio' | 'size',
    alignCenter: boolean,
  ) => {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPopoverAnchor({
      left: alignCenter ? rect.left + rect.width / 2 : rect.left,
      top: rect.bottom + 8,
    });
    setOpenPopover(current => (current === kind ? null : kind));
  };

  useEffect(() => {
    if (openPopover === null) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (cameraPanelRef.current?.contains(target)) return;
      if (stylePanelRef.current?.contains(target)) return;
      if (canvasPanelRef.current?.contains(target)) return;
      if (modelPanelRef.current?.contains(target)) return;
      if (ratioPanelRef.current?.contains(target)) return;
      if (sizePanelRef.current?.contains(target)) return;
      setOpenPopover(null);
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [openPopover]);

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isGenerating) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (canRun) onGenerate();
    }
  };

  const refsByAssetId = new Map(canvasImageAssets.map(asset => [asset.id, asset]));
  // 计数要把连线派生的参考图算进去——否则用户连了线却看到 "0"，正是本次要修的症状。
  const referenceCount = referenceRefs.length + edgeReferenceRefs.length;
  const modelOptionsList = lockOptionsToCatalog || modelOptions.length > 0
    ? modelOptions
    : [{ id: DEFAULT_MODEL_ID, name: DEFAULT_MODEL_ID }];
  const modelName = modelOptionsList.find(item => item.id === fields.modelId)?.name || fields.modelId || '选择模型';
  const ratioOptionsList = lockOptionsToCatalog
    ? (aspectRatioOptions ?? [])
    : (aspectRatioOptions?.length ? aspectRatioOptions : [...ASPECT_RATIO_OPTIONS]);
  const sizeOptionsList = lockOptionsToCatalog
    ? (imageSizeOptions ?? [])
    : (imageSizeOptions?.length ? imageSizeOptions : [...IMAGE_SIZE_OPTIONS]);
  const isVideo = mediaType === 'video';
  const resolutionOptionsList = lockOptionsToCatalog
    ? (resolutionOptions ?? [])
    : (resolutionOptions?.length ? resolutionOptions : ['720p', '1080p']);
  const durationOptionsList = lockOptionsToCatalog
    ? (durationOptions ?? [])
    : (durationOptions?.length ? durationOptions : ['4', '6', '8', '10']);
  const showCountChip = (maxGenerationCount ?? 4) > 1;
  const sizeChipOptions = isVideo ? resolutionOptionsList : sizeOptionsList;

  return (
    <div
      ref={rootRef}
      className={GENERATION_COMPOSER_PANEL}
      // Same fill and stroke as the node frame (see the palette note: the global
      // `* { border-color }` rule outranks border utilities, so this is inline).
      style={GENERATION_COMPOSER_SURFACE_STYLE}
      onMouseDown={event => event.stopPropagation()}
    >
      {previewOnly ? (
        <div className="mb-2 text-[10px] leading-4 text-amber-200/90">本地预览，尚未接通网站模型</div>
      ) : lockOptionsToCatalog ? (
        <div className="mb-2 text-[10px] leading-4 text-text-secondary">生成将按网站规则计费</div>
      ) : null}
      {catalogMessage ? (
        <div className="mb-2 text-[10px] leading-4 text-status-error" role="alert">{catalogMessage}</div>
      ) : null}
      {/* Top: reference / camera / style */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          ref={canvasTriggerRef}
          type="button"
          disabled={isGenerating}
          className={cn(GENERATION_PILL, openPopover === 'canvas' && GENERATION_PILL_ACTIVE)}
          onClick={event => {
            event.stopPropagation();
            openPopoverFor(canvasTriggerRef.current, 'canvas', true);
          }}
        >
          <ImagePlus className="h-3 w-3 shrink-0" strokeWidth={2.4} />
          {isVideo ? '参考素材' : '参考图'}
          {referenceCount > 0 ? (
            <span className="rounded-full bg-white/15 px-1.5 text-[10px] leading-4 text-white/80">{referenceCount}</span>
          ) : null}
        </button>
        <button
          ref={cameraTriggerRef}
          type="button"
          disabled={isGenerating}
          className={cn(GENERATION_PILL, openPopover === 'camera' && GENERATION_PILL_ACTIVE)}
          onClick={event => {
            event.stopPropagation();
            openPopoverFor(cameraTriggerRef.current, 'camera', true);
          }}
        >
          <Camera className="h-3 w-3 shrink-0" strokeWidth={2.4} />
          {presetLabel(CAMERA_PRESETS, fields.cameraPreset)}
        </button>
        <button
          ref={styleTriggerRef}
          type="button"
          disabled={isGenerating}
          className={cn(GENERATION_PILL, openPopover === 'style' && GENERATION_PILL_ACTIVE)}
          onClick={event => {
            event.stopPropagation();
            openPopoverFor(styleTriggerRef.current, 'style', true);
          }}
        >
          <Palette className="h-3 w-3 shrink-0" strokeWidth={2.4} />
          {presetLabel(STYLE_PRESETS, fields.stylePreset)}
        </button>
        {referenceRefs.map(ref => {
          const asset = refsByAssetId.get(ref.assetId);
          return (
            <button
              key={ref.assetId}
              type="button"
              title={asset?.title || ref.url || '参考图'}
              disabled={isGenerating || !asset}
              className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-white/15 bg-black/30"
              onClick={event => {
                event.stopPropagation();
                if (asset) onToggleReference(asset);
              }}
            >
              <AssetThumb url={ref.url || ''} alt="" />
              {!isGenerating && asset ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                  <X className="h-3 w-3 text-white" strokeWidth={2.6} />
                </span>
              ) : null}
            </button>
          );
        })}
        {/*
          连线派生的参考图：只读。它们的存在由连线决定，所以没有删除按钮——
          取消引用应当靠删连线，而不是把上游资产复制进本节点的 assetRefs。
        */}
        {edgeReferenceRefs.map(ref => (
          <span
            key={`edge:${ref.assetId}`}
            title={`来自连线：${ref.sourceNodeTitle}`}
            className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-dashed border-primary/50 bg-black/30"
          >
            <AssetThumb url={ref.url || ''} alt="" />
            <span className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 rounded-tl bg-primary/80" />
          </span>
        ))}
        {unusableUpstreamCount > 0 ? (
          <span
            className="text-[10px] leading-4 text-warning"
            title="连线上的图片没有资产记录，生成时不会被采用；请从素材库选择或重新上传该图片"
          >
            有 {unusableUpstreamCount} 张连线图片无资产记录，不会生效
          </span>
        ) : null}
      </div>

      {/* Prompt: borderless free text — no nested input frame */}
      <textarea
        ref={promptRef}
        value={prompt}
        readOnly={isGenerating}
        disabled={isGenerating}
        placeholder="今天我们要创作什么"
        rows={3}
        onChange={event => patch({ prompt: event.target.value })}
        onKeyDown={handlePromptKeyDown}
        onMouseDown={event => event.stopPropagation()}
        className={GENERATION_PROMPT}
      />

      {/* Bottom: param chips + run button */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          ref={modelTriggerRef}
          type="button"
          disabled={isGenerating}
          title="Model"
          className={cn(GENERATION_CHIP, openPopover === 'model' && GENERATION_CHIP_ACTIVE)}
          onClick={event => {
            event.stopPropagation();
            openPopoverFor(modelTriggerRef.current, 'model', false);
          }}
        >
          <span className="truncate">{modelName}</span>
        </button>
        {sizeChipOptions.length ? (
          <button
            ref={sizeTriggerRef}
            type="button"
            disabled={isGenerating}
            title={isVideo ? '分辨率' : '图片尺寸'}
            className={cn(GENERATION_CHIP, openPopover === 'size' && GENERATION_CHIP_ACTIVE)}
            onClick={event => {
              event.stopPropagation();
              openPopoverFor(sizeTriggerRef.current, 'size', true);
            }}
          >
            {isVideo ? fields.resolution : fields.imageSize}
          </button>
        ) : null}
        {ratioOptionsList.length ? (
          <button
            ref={ratioTriggerRef}
            type="button"
            disabled={isGenerating}
            title="画面比例"
            className={cn(GENERATION_CHIP, openPopover === 'ratio' && GENERATION_CHIP_ACTIVE)}
            onClick={event => {
              event.stopPropagation();
              openPopoverFor(ratioTriggerRef.current, 'ratio', true);
            }}
          >
            {fields.aspectRatio}
          </button>
        ) : null}
        {isVideo && durationOptionsList.length ? (
          <button
            type="button"
            disabled={isGenerating}
            title="时长（秒）"
            className={GENERATION_CHIP}
            onClick={event => {
              event.stopPropagation();
              const idx = durationOptionsList.indexOf(fields.durationSeconds);
              const next = durationOptionsList[(idx + 1) % durationOptionsList.length] || durationOptionsList[0];
              patch({ durationSeconds: next });
            }}
          >
            {fields.durationSeconds || '4'}s
          </button>
        ) : null}
        {showCountChip ? (
          <button
            type="button"
            disabled={isGenerating}
            title={isVideo ? '生成条数（点击切换 1 / 2 / 4）' : '生成张数（点击切换 1 / 2 / 4）'}
            className={GENERATION_CHIP}
            onClick={event => {
              event.stopPropagation();
              const order = [1, 2, 4].filter(value => value <= (maxGenerationCount ?? 4));
              const idx = order.indexOf(Number(count) || 1);
              const next = order[(idx + 1) % order.length] || order[0] || 1;
              patch({ generationCount: next });
            }}
          >
            {count}x
          </button>
        ) : null}
        {isGenerating ? (
          <button
            type="button"
            className={GENERATION_BTN_MUTED}
            onClick={event => {
              event.stopPropagation();
              onCancel?.();
            }}
          >
            取消
          </button>
        ) : (
          <button
            type="button"
            disabled={!canRun}
            title={runDisabledReason ?? (previewOnly ? `本地预览 (${count})` : `生成将按网站规则计费 (${count})`)}
            className={GENERATION_BTN_PRIMARY}
            onClick={event => {
              event.stopPropagation();
              onGenerate();
            }}
          >
            <Zap className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
            Run
          </button>
        )}
      </div>

      {generationError ? (
        <div role="alert" className="mt-1.5 text-[10px] leading-4 text-status-error">{generationError}</div>
      ) : null}
      {!isGenerating && runDisabledReason ? (
        <div className={cn('mt-1 text-right text-[10px]', GENERATION_MUTED)}>{runDisabledReason}</div>
      ) : null}

      {openPopover === 'camera' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={cameraPanelRef}
          className={cn(GENERATION_POPOVER, 'w-[260px]')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top, transform: 'translateX(-50%)' }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>Camera</div>
          <div className="grid grid-cols-2 gap-1">
            <PresetOption active={fields.cameraPreset === null} label="无" onClick={() => { patch({ cameraPreset: null }); closePopover(); }} />
            {CAMERA_PRESETS.map(preset => (
              <PresetOption
                key={preset.id}
                active={fields.cameraPreset === preset.id}
                label={preset.label}
                onClick={() => { patch({ cameraPreset: preset.id }); closePopover(); }}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}

      {openPopover === 'style' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={stylePanelRef}
          className={cn(GENERATION_POPOVER, 'w-[260px]')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top, transform: 'translateX(-50%)' }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>Style</div>
          <div className="grid grid-cols-2 gap-1">
            <PresetOption active={fields.stylePreset === null} label="无" onClick={() => { patch({ stylePreset: null }); closePopover(); }} />
            {STYLE_PRESETS.map(preset => (
              <PresetOption
                key={preset.id}
                active={fields.stylePreset === preset.id}
                label={preset.label}
                onClick={() => { patch({ stylePreset: preset.id }); closePopover(); }}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}

      {openPopover === 'model' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={modelPanelRef}
          className={cn(GENERATION_POPOVER, 'w-[260px] p-2')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>Model</div>
          <div className="max-h-[240px] space-y-1 overflow-y-auto">
            {modelOptionsList.map(option => (
              <button
                key={option.id}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px]',
                  option.id === fields.modelId ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/8 hover:text-white',
                )}
                onClick={() => {
                  patch({ modelId: option.id });
                  closePopover();
                }}
              >
                <span className="truncate">{option.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {null}
                  {option.id === fields.modelId ? <Check className="h-3 w-3" strokeWidth={2.6} /> : null}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}

      {openPopover === 'size' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={sizePanelRef}
          className={cn(GENERATION_POPOVER, 'w-[160px] p-2')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top, transform: 'translateX(-50%)' }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>{isVideo ? '分辨率' : '图片尺寸'}</div>
          <div className="flex flex-col gap-1">
            {(isVideo ? resolutionOptionsList : sizeOptionsList).map(size => (
              <button
                key={size}
                type="button"
                className={(isVideo ? fields.resolution : fields.imageSize) === size ? GENERATION_POPOVER_OPTION_ACTIVE : GENERATION_POPOVER_OPTION}
                onClick={() => {
                  patch(isVideo ? { resolution: size } : { imageSize: size });
                  closePopover();
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}

      {openPopover === 'ratio' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={ratioPanelRef}
          className={cn(GENERATION_POPOVER, 'w-[280px] p-2')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top, transform: 'translateX(-50%)' }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>画面比例</div>
          <div className="grid grid-cols-4 gap-1">
            {ratioOptionsList.map(ratio => {
              const outline = ratioOutlineStyle(ratio === 'auto' ? '1:1' : ratio);
              const active = ratio === fields.aspectRatio;
              return (
                <button
                  key={ratio}
                  type="button"
                  title={ratio}
                  className={cn(
                    'inline-flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-[10px]',
                    active ? 'border-white/30 bg-white/12 text-white' : 'border-white/12 text-white/70 hover:border-white/25',
                  )}
                  onClick={() => {
                    patch({ aspectRatio: ratio });
                    closePopover();
                  }}
                >
                  {ratio === 'auto' ? (
                    <Zap className="h-3 w-3" strokeWidth={2.4} />
                  ) : (
                    <span className="inline-block rounded-[3px] border border-current/70" style={outline} />
                  )}
                  {ratio}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {openPopover === 'canvas' && popoverAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={canvasPanelRef}
          className={cn(GENERATION_POPOVER, 'w-[280px] p-2')}
          style={{ left: popoverAnchor.left, top: popoverAnchor.top, transform: 'translateX(-50%)' }}
          onMouseDown={event => event.stopPropagation()}
        >
          <div className={cn('mb-1.5 px-1', GENERATION_MUTED)}>从画布选择参考图</div>
          {canvasImageAssets.length > 0 ? (
            <div className="grid max-h-[240px] grid-cols-3 gap-1.5 overflow-y-auto">
              {canvasImageAssets.map(asset => {
                const active = referenceRefs.some(ref => ref.assetId === asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={cn(
                      'relative aspect-square overflow-hidden rounded-lg border bg-black/30',
                      active ? 'border-white/50' : 'border-white/12 hover:border-white/30',
                    )}
                    title={asset.title || asset.url || '图片素材'}
                    onClick={event => {
                      event.stopPropagation();
                      onToggleReference(asset);
                    }}
                  >
                    <AssetThumb url={asset.url || asset.storageKey || ''} alt="" />
                    {active ? (
                      <span className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/12 px-2 py-3 text-center text-[11px] text-white/45">
              暂无图片素材
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
});

function PresetOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={active ? GENERATION_POPOVER_OPTION_ACTIVE : GENERATION_POPOVER_OPTION}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

CanvasNodeComposer.displayName = 'CanvasNodeComposer';
