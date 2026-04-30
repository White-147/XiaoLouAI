/**
 * Post-success image node floating toolbar (reference UI).
 * 视觉 1:1 + 可选 onToolbarAction；主条无发 X；「同步」在更多内。
 */
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  ChevronRight,
  CloudUpload,
  Crop,
  Eraser,
  Layers2,
  MoreHorizontal,
  MousePointer2,
  Settings2,
  Shapes,
  SlidersHorizontal,
} from 'lucide-react';

const STROKE = 1.5;
const isz = (n: number) => ({ size: n, strokeWidth: STROKE } as const);

export type ImageNodeToolbarActionId =
  | 'quickEdit'
  | 'upscale'
  | 'removeBackground'
  | 'eraser'
  | 'editElements'
  | 'editText'
  | 'multiAngle'
  | 'moveObject'
  | 'download'
  | 'more:mockup'
  | 'more:expand'
  | 'more:adjust'
  | 'more:crop'
  | 'more:vector'
  | 'more:flipRotate'
  | 'more:customizeToolbar'
  | 'more:sync'
  | 'videoExtend';

export function IconHDSquare() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <rect x="2" y="2" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <text x="9" y="12.2" textAnchor="middle" className="fill-current font-sans text-[6.5px] font-bold">
        HD
      </text>
    </svg>
  );
}

export function IconRemoveBackground() {
  /** 虚线人像轮廓 + 虚线外框，贴近参考图「去背景」 */
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <rect
        x="2.4"
        y="2.4"
        width="13.2"
        height="13.2"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeDasharray="1.5 1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="9"
        cy="6.5"
        r="2.15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeDasharray="0.6 0.5"
        strokeLinecap="round"
      />
      <path
        d="M4.6 14.1c.85-1.35 1.1-1.2 1.1-1.2h6.5s.24-.15 1.1 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeDasharray="0.5 0.5"
        strokeLinejoin="round"
      />
      <path
        d="M4.1 10.1c.35-.55 1-1.05 1.3-1.1l1-1.15c.25-.28.55-.4.8-.4h.45c.28 0 .58.1.8.4l.95 1.15c.3.1 1.05.5 1.3 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeDasharray="0.4 0.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconEditText() {
  /** 线框、线描 T、右下斜笔与左下三角笔尖 */
  const w = 1.12;
  return (
    <svg viewBox="0 0 18 18" className="block h-[18px] w-[18px] shrink-0" fill="none" aria-hidden>
      <path
        d="M2 2L16 2L16 12L12 16L2 16L2 2Z"
        stroke="currentColor"
        strokeWidth={w}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="4.15"
        y1="3.72"
        x2="13.85"
        y2="3.72"
        stroke="currentColor"
        strokeWidth={w}
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="3.72"
        x2="9"
        y2="8.85"
        stroke="currentColor"
        strokeWidth={w}
        strokeLinecap="round"
      />
      <line
        x1="9.9"
        y1="14.0"
        x2="15.0"
        y2="7.6"
        stroke="currentColor"
        strokeWidth={1.05}
        strokeLinecap="round"
      />
      <path
        d="M9.85 14.05L10.2 13.5L9.3 13.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMultiAngleCube() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <path
        d="M9 2.2l5.2 2.3v5.1L9 11.6 3.8 9.6V4.4L9 2.2zM3.8 9.6L9 11.6l5.2-2M9 4.2v7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMoveObject() {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
      <svg className="absolute left-0 top-0" viewBox="0 0 18 18" width={18} height={18} aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="10.5"
          height="10.5"
          rx="1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.15}
          strokeDasharray="2.1 1.2"
        />
      </svg>
      <MousePointer2 className="absolute bottom-0.5 right-0.5" size={8} strokeWidth={2.2} />
    </span>
  );
}

function IconMockupShirt() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        d="M4.2 3.5h1.2l1.2-0.8h3.1l1.1 0.8h1.3L13 4.2v1.1l-0.6 0.3V14H5.6V5.6L5 5.3V4.2L4.2 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconExpandCorners() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden>
      <rect x="4.2" y="4.2" width="6.2" height="6.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <path
        d="M2.3 4.2V2.2h2M2.2 2.2h2v2M12 2.2h2v2M12 2.2v-2h2M2.2 12v2h2M2.2 12h-2v2M14 12h2.2v2.2H14M14 12v-2.2M14.2 14.2H12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconVectorNodes() {
  return <Shapes {...isz(16)} className="shrink-0" />;
}

function IconFlipRotate() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden>
      <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="currentColor" strokeWidth="1" />
      <path
        d="M4 5.5A4.5 4.5 0 0 1 7.5 2M14 5.5A4.5 4.5 0 0 0 10.5 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconDownloadTray() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <path
        d="M2.5 10.2h3.2V14h6.6v-3.8h3.2L9 3.2 2.5 10.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line x1="1" y1="15.2" x2="17" y2="15.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

const MORE_rows: Array<{
  id: ImageNodeToolbarActionId;
  label: string;
  icon: React.ReactNode;
  badgeDot?: boolean;
  badgeText?: string;
  dividerAfter?: boolean;
}> = [
  { id: 'more:mockup', label: 'Mockup', icon: <IconMockupShirt /> },
  { id: 'more:expand', label: '扩展', icon: <IconExpandCorners />, badgeDot: true },
  { id: 'more:adjust', label: '调整', icon: <SlidersHorizontal {...isz(16)} />, badgeDot: true },
  { id: 'more:crop', label: '裁剪', icon: <Crop {...isz(16)} />, badgeDot: false },
  { id: 'more:vector', label: '矢量', icon: <IconVectorNodes />, badgeDot: true, badgeText: '9' },
  { id: 'more:flipRotate', label: '翻转与旋转', icon: <IconFlipRotate />, badgeDot: true, dividerAfter: true },
];

export interface ImageNodeFloatingToolbarProps {
  nodeId: string;
  isDark: boolean;
  resultUrl: string;
  localScale: number;
  isStoryboardExtract?: boolean;
  allowCameraAngle?: boolean;
  angleMode?: boolean;
  onUpdateAngleMode: (open: boolean) => void;
  onExpand?: (url: string) => void;
  onOpenEditor?: (nodeId: string) => void;
  onSyncToProjectAssets?: (nodeId: string) => void;
  onToolbarAction?: (nodeId: string, action: ImageNodeToolbarActionId) => void;
}

type ItemDef = { id: ImageNodeToolbarActionId; label: string; node: React.ReactNode };

function runWithOptionalParent(
  onToolbarAction: ImageNodeFloatingToolbarProps['onToolbarAction'],
  nodeId: string,
  id: ImageNodeToolbarActionId,
  fallback: () => void
) {
  if (onToolbarAction) onToolbarAction(nodeId, id);
  else fallback();
}

export const ImageNodeFloatingToolbar: React.FC<ImageNodeFloatingToolbarProps> = ({
  nodeId,
  isDark,
  resultUrl,
  localScale,
  isStoryboardExtract = false,
  allowCameraAngle = true,
  angleMode = false,
  onUpdateAngleMode,
  onExpand,
  onOpenEditor,
  onSyncToProjectAssets,
  onToolbarAction,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** 在左右空间不足时整体缩小，保证主条一次完整可见（优先于横向滚动） */
  const [fitScale, setFitScale] = useState(1);
  const compact = fitScale < 0.88;

  useLayoutEffect(() => {
    const el = containerRef.current;
    const pill = contentRef.current;
    if (!el || !pill) return;

    const update = () => {
      const cw = el.clientWidth;
      const pw = pill.offsetWidth;
      if (cw <= 0 || pw <= 0) return;
      const next = Math.max(0.48, Math.min(1, (cw - 4) / pw));
      setFitScale(next);
    };

    update();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(update);
    });
    ro.observe(el);
    ro.observe(pill);
    return () => ro.disconnect();
  }, [nodeId, isStoryboardExtract, allowCameraAngle, moreOpen, angleMode]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: PointerEvent) => {
      if (!moreRootRef.current) return;
      if (!moreRootRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [moreOpen]);

  const doDownload = () => {
    onToolbarAction?.(nodeId, 'download');
    const filename = `image_${nodeId}.png`;
    const cleanUrl = resultUrl.split('?')[0];
    if (resultUrl.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = resultUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      fetch(cleanUrl, { cache: 'no-store' })
        .then((r) => r.blob())
        .then((blob) => {
          const u = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = u;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(u);
        })
        .catch(() => {
          const link = document.createElement('a');
          link.href = cleanUrl;
          link.download = filename;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        });
    }
  };

  const mainItems: ItemDef[] = [
    { id: 'upscale', label: '放大', node: <IconHDSquare /> },
    { id: 'removeBackground', label: '去背景', node: <IconRemoveBackground /> },
    { id: 'eraser', label: '橡皮工具', node: <Eraser {...isz(18)} className="shrink-0" /> },
    { id: 'editElements', label: '编辑元素', node: <Layers2 {...isz(18)} className="shrink-0" /> },
    { id: 'editText', label: '编辑文字', node: <IconEditText /> },
  ];
  if (!isStoryboardExtract && allowCameraAngle) {
    mainItems.push({ id: 'multiAngle', label: '多角度', node: <IconMultiAngleCube /> });
  }
  mainItems.push({ id: 'moveObject', label: '移动对象', node: <IconMoveObject /> });

  const shell = isDark
    ? 'border border-white/12 bg-[#151412]/[0.97] text-[#e8e6e0] shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
    : 'border border-[rgba(0,0,0,0.08)] bg-white text-[#141413] shadow-[0_2px_16px_rgba(0,0,0,0.08),0_0_1px_rgba(0,0,0,0.04)]';
  const btn = isDark ? 'text-[#d6d4cf] hover:bg-white/8' : 'text-[#1a1a1a] hover:bg-black/[0.04]';
  const morePanel = isDark
    ? 'border border-white/10 bg-[#1a1916] text-[#e8e6e0] shadow-xl'
    : 'border border-[rgba(0,0,0,0.08)] bg-white text-[#1a1a1a] shadow-lg';

  const tMain = compact ? 'text-[11px] font-medium' : 'text-[12px] font-medium';
  const padBtn = compact ? 'px-1' : 'px-1.5';
  const hRow = compact ? 'min-h-[28px] h-[28px]' : 'min-h-[30px] h-[30px]';
  /** 与主画布 `TopBar` 左上角 `chuangjing` 按钮同构：圆形容器 + 内置 logo */
  const quickEditLogoWrap = isDark
    ? 'bg-[#171612] hover:opacity-95'
    : 'bg-[#f9f8f6] hover:opacity-95';

  return (
    <div
      ref={containerRef}
      className="w-full min-w-0 max-w-full overflow-visible"
      style={{
        transform: `scale(${localScale * fitScale})`,
        transformOrigin: 'bottom center',
      }}
    >
      <div
        ref={contentRef}
        className={`inline-flex w-max shrink-0 flex-nowrap items-stretch gap-0 rounded-full ${compact ? 'px-1 py-0' : 'px-1.5 py-0.5'} ${shell} select-none`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            runWithOptionalParent(onToolbarAction, nodeId, 'quickEdit', () => onOpenEditor?.(nodeId));
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`flex ${hRow} shrink-0 items-center gap-1 rounded-full pl-1.5 pr-1.5 text-left ${tMain} ${btn} transition-colors`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-0 p-0 transition-opacity ${quickEditLogoWrap}`}
            aria-hidden
          >
            <img
              src="/chuangjing-logo.png"
              alt=""
              className="h-full w-full object-contain p-1.5"
              draggable={false}
            />
          </span>
          <span>快捷编辑</span>
          <span
            className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-normal ${
              isDark ? 'text-white/40' : 'text-neutral-400'
            }`}
          >
            Tab
          </span>
        </button>

        <div
          className={`${compact ? 'mx-1' : 'mx-1.5'} w-px shrink-0 self-stretch ${
            isDark ? 'bg-white/12' : 'bg-neutral-200'
          }`}
        />

        <div className="flex min-w-0 items-center gap-0 pr-0.5">
          {mainItems.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (it.id === 'multiAngle') {
                  onUpdateAngleMode(!angleMode);
                  onToolbarAction?.(nodeId, 'multiAngle');
                } else {
                  runWithOptionalParent(onToolbarAction, nodeId, it.id, () => {});
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`flex ${hRow} shrink-0 items-center gap-0.5 rounded-md ${padBtn} ${tMain} ${
                it.id === 'multiAngle' && angleMode
                  ? isDark
                    ? 'bg-white/10 text-white'
                    : 'bg-[#0f0f0e] text-white'
                  : btn
              } transition-colors`}
            >
              {it.node}
              <span className="whitespace-nowrap">{it.label}</span>
            </button>
          ))}

          <div className="relative flex shrink-0" ref={moreRootRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMoreOpen((o) => !o);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`${btn} flex ${hRow} items-center rounded-md ${padBtn}`}
              title="更多"
            >
              <MoreHorizontal {...isz(18)} className="shrink-0" />
            </button>

            {moreOpen ? (
              <div
                className={`absolute left-1/2 top-[calc(100%+6px)] z-[200] w-[min(100vw-2rem,240px)] -translate-x-1/2 overflow-hidden rounded-xl py-1.5 text-[13px] ${morePanel}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {onSyncToProjectAssets ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToolbarAction?.(nodeId, 'more:sync');
                      onSyncToProjectAssets(nodeId);
                      setMoreOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
                      isDark ? 'hover:bg-white/6' : 'hover:bg-black/[0.04]'
                    }`}
                  >
                    <span className="inline-flex w-[20px] shrink-0 items-center justify-center text-current">
                      <CloudUpload {...isz(16)} className="shrink-0" />
                    </span>
                    <span className="min-w-0 flex-1">同步到项目</span>
                  </button>
                ) : null}

                {MORE_rows.map((row) => (
                  <div key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onToolbarAction?.(nodeId, row.id);
                        if (row.id === 'more:expand') onExpand?.(resultUrl);
                        setMoreOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
                        isDark ? 'hover:bg-white/6' : 'hover:bg-black/[0.04]'
                      }`}
                    >
                      <span className="inline-flex w-[20px] shrink-0 items-center justify-center text-current">
                        {row.icon}
                      </span>
                      <span className="min-w-0 flex-1">{row.label}</span>
                      {row.badgeText ? (
                        <span
                          className={`rounded border px-1.5 text-[10px] font-medium leading-tight ${
                            isDark ? 'border-amber-400/35 text-amber-100' : 'border-amber-400/50 text-amber-800'
                          }`}
                        >
                          {row.badgeText}
                        </span>
                      ) : null}
                      {row.badgeDot && !row.badgeText ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                      ) : null}
                    </button>
                    {row.dividerAfter ? (
                      <div className={`my-0.5 h-px w-full ${isDark ? 'bg-white/8' : 'bg-neutral-200'}`} />
                    ) : null}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    runWithOptionalParent(onToolbarAction, nodeId, 'more:customizeToolbar', () => {});
                    setMoreOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left ${
                    isDark ? 'hover:bg-white/6' : 'hover:bg-black/[0.04]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex w-[20px] shrink-0 items-center justify-center text-current">
                      <Settings2 {...isz(16)} className="shrink-0 opacity-80" />
                    </span>
                    <span>自定义工具栏</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`${compact ? 'mx-1' : 'mx-1.5'} w-px shrink-0 self-stretch ${
            isDark ? 'bg-white/12' : 'bg-neutral-200'
          }`}
        />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            doDownload();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`flex ${hRow} shrink-0 items-center justify-center gap-0.5 rounded-md ${compact ? 'px-2' : 'px-2.5'} ${tMain} ${btn}`}
          title="下载"
        >
          <IconDownloadTray />
        </button>
      </div>
    </div>
  );
};
