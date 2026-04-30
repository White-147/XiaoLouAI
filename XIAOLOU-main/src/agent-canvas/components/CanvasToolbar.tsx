import React from 'react';
import {
  ArrowUpRight,
  Hand,
  Hash,
  Image as ImageIcon,
  ImageUp,
  MapPin,
  MousePointer2,
  PenLine,
  Pentagon,
  Sparkles,
  Square,
  Star,
  Type,
  Video,
} from 'lucide-react';

export type CanvasTool = 'select' | 'hand';

type ToolbarMenu = 'tools' | 'upload' | 'shapes' | null;

/** Which primary bar control is in the “selected” state (same pill as the first group). */
type ToolbarActiveSlot =
  | 'tools'
  | 'pin'
  | 'upload'
  | 'workflows'
  | 'shapes'
  | 'pen'
  | 'text'
  | 'aiImage'
  | 'aiVideo'
  | 'aiText';

/** 参考主工具条：外轮廓 ~1.5px、图标 18 见方、炭黑 #1A1A1A、选中反白 */
const TOOL_ICON_SIZE = 18;
const TOOL_STROKE = 1.5;
const ti = { size: TOOL_ICON_SIZE, strokeWidth: TOOL_STROKE } as const;
const isz = (s: number) => ({ size: s, strokeWidth: TOOL_STROKE } as const);

interface CanvasToolbarProps {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  canvasTheme?: 'dark' | 'light';
  onWorkflowsClick?: (e: React.MouseEvent) => void;
  onAssetsClick?: (e: React.MouseEvent) => void;
  onHistoryClick?: (e: React.MouseEvent) => void;
  onImportMediaFiles?: (files: File[]) => void;
  showWorkflows?: boolean;
  showAssets?: boolean;
  showHistory?: boolean;
}

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  isDark: boolean;
  showTooltip?: boolean;
  redDot?: boolean;
  children: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  label,
  shortcut,
  active = false,
  isDark,
  showTooltip = false,
  redDot = false,
  children,
  onClick,
  onMouseEnter,
}) => {
  const activeClassName = isDark ? 'bg-white/12 text-white' : 'bg-[#1A1A1A] text-white';
  const idleClassName = isDark
    ? 'text-[#a3a19b] hover:bg-white/10 hover:text-[#f5f4ef]'
    : 'text-[#1A1A1A] hover:bg-[#F0F0F0]';

  const nativeTitle = showTooltip
    ? undefined
    : (shortcut ? `${label} (${shortcut})` : label);

  return (
    <button
      type="button"
      aria-label={shortcut ? `${label}，快捷键 ${shortcut}` : label}
      title={nativeTitle}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`group/tool relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
        active ? activeClassName : idleClassName
      }`}
    >
      {children}
      {redDot ? (
        <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--toolbar-surface)] bg-[#ff5b4f]" />
      ) : null}
      {showTooltip ? (
        <span
          className={`pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-[90] -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-normal leading-5 opacity-0 shadow-md transition-opacity duration-150 group-hover/tool:opacity-100 ${
            isDark
              ? /* 深色底栏：浅色浮层，与参考图在浅色条上的深底浮层形成对调 */
                'border border-white/10 bg-[#f2f1ec] text-[#141413]'
              : /* 浅色底栏：深色浮层（同参考图） */
                'border border-black/8 bg-[#1c1c1a] text-white'
          }`}
        >
          {label}
          {shortcut ? (
            <span
              className={
                isDark
                  ? 'ml-1.5 text-[13px] text-[#6a6a66] tabular-nums'
                  : 'ml-1.5 text-[13px] text-white/50 tabular-nums'
              }
            >
              {shortcut}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
};

const Separator: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <div
    className={`mx-1 h-4 w-px flex-shrink-0 ${
      isDark ? 'bg-white/12' : 'bg-[#D0D0D0]'
    }`}
  />
);

const MenuShell: React.FC<{
  isDark: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ isDark, className = '', children }) => (
  <div
    className={`absolute bottom-[calc(100%+8px)] z-[80] rounded-xl border p-1 text-[13px] text-current shadow-md ${
      isDark
        ? 'border-[rgba(245,244,239,0.12)] bg-[#171612]/98 text-[#f5f4ef] backdrop-blur-sm'
        : 'border-[rgba(26,26,25,0.08)] bg-white text-[#1A1A1A]'
    } ${className}`}
  >
    {children}
  </div>
);

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  isDark: boolean;
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, label, shortcut, isDark, active = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-normal leading-4 transition-colors ${
      active
        ? isDark
          ? 'bg-white/15 text-[#f5f4ef]'
          : 'bg-[#e2e1dd] text-[#100f09] ring-1 ring-inset ring-[rgba(26,26,25,0.08)]'
        : isDark
          ? 'hover:bg-white/10'
          : 'hover:bg-[#ecebe8]'
    }`}
  >
    <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-current [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5]">
      {icon}
    </span>
    <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
    {shortcut ? (
      <span
        className={`shrink-0 pl-1 text-[12px] tabular-nums leading-4 ${
          isDark ? 'text-[#7a7a78]' : 'text-[#9c9c99]'
        }`}
      >
        {shortcut}
      </span>
    ) : null}
  </button>
);

/** 圆角方框 + 内嵌三角播放（与参考条「视频+星」一致） */
const VideoPlayInSquareIcon: React.FC<{ size?: number }> = ({ size = TOOL_ICON_SIZE }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="shrink-0 text-current"
    aria-hidden
  >
    <rect
      x="4"
      y="5"
      width="16"
      height="12"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth={TOOL_STROKE}
      strokeLinejoin="round"
    />
    <path
      d="M10.5 8.2v6.1c0 .2.1.2.2.1l4.2-2.1c.1-.1.1-.2 0-.3l-4.2-2.1c-.1-.1-.2 0-.2.1Z"
      fill="currentColor"
    />
  </svg>
);

/** 圆角框 + 大写 T，四角星在右下（参考条「字体+星」） */
const TextInSquareWithSparkleIcon: React.FC<{ size?: number }> = ({ size = TOOL_ICON_SIZE }) => {
  const spark = Math.max(7, Math.round(size * 0.4));
  return (
    <span
      className="relative inline-flex items-center justify-center overflow-visible"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-current">
        <rect
          x="3.5"
          y="4.5"
          width="12"
          height="12"
          rx="2.25"
          stroke="currentColor"
          strokeWidth={TOOL_STROKE}
        />
        <path
          d="M6.8 7.8h6.4M10 7.8v5.1"
          stroke="currentColor"
          strokeWidth={TOOL_STROKE}
          strokeLinecap="round"
        />
        <path
          d="M8.2 14.5h3.5"
          stroke="currentColor"
          strokeWidth={TOOL_STROKE}
          strokeLinecap="round"
        />
      </svg>
      <Sparkles
        className="pointer-events-none absolute -bottom-0.5 -right-0.5 text-current"
        size={spark}
        strokeWidth={TOOL_STROKE}
        aria-hidden
      />
    </span>
  );
};

const SparkleBadgeIcon: React.FC<{
  type: 'image' | 'video' | 'text';
  size?: number;
}> = ({ type, size = TOOL_ICON_SIZE }) => {
  const sparkS = Math.max(7, Math.round(size * 0.4));
  if (type === 'image') {
    return (
      <span
        className="relative inline-flex items-center justify-center overflow-visible"
        style={{ width: size, height: size }}
      >
        <ImageIcon {...isz(size)} className="shrink-0" />
        <Sparkles
          className="pointer-events-none absolute -right-0.5 -top-0.5 text-current"
          size={sparkS}
          strokeWidth={TOOL_STROKE}
        />
      </span>
    );
  }
  if (type === 'video') {
    return (
      <span
        className="relative inline-flex items-center justify-center overflow-visible"
        style={{ width: size, height: size }}
      >
        <VideoPlayInSquareIcon size={size} />
        <Sparkles
          className="pointer-events-none absolute -right-0.5 -top-0.5 text-current"
          size={sparkS}
          strokeWidth={TOOL_STROKE}
        />
      </span>
    );
  }
  return <TextInSquareWithSparkleIcon size={size} />;
};

const ShapeMenuIcon: React.FC<{
  shape: string;
  size?: number;
}> = ({ shape, size = TOOL_ICON_SIZE }) => {
  const t = { ...ti, size };
  switch (shape) {
    case '矩形':
      return <Square {...t} className="shrink-0" />;
    case '线条':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className="shrink-0 text-current"
          aria-hidden
        >
          <line
            x1="6.5"
            y1="16.5"
            x2="16.5"
            y2="6.5"
            stroke="currentColor"
            strokeWidth={TOOL_STROKE}
            strokeLinecap="round"
          />
        </svg>
      );
    case '箭头':
      return <ArrowUpRight {...t} className="shrink-0" />;
    case '椭圆':
      return (
        <span
          className="box-border block h-3.5 w-3.5 shrink-0 rounded-full border border-current [border-width:1.5px]"
        />
      );
    case '多边形':
      return <Pentagon {...t} className="shrink-0" />;
    case '星形':
      return <Star {...t} className="shrink-0" />;
    default:
      return <Square {...t} className="shrink-0" />;
  }
};

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  activeTool,
  onToolChange,
  onAddText,
  onAddImage,
  onAddVideo,
  zoom: _zoom,
  onZoomChange: _onZoomChange,
  canvasTheme = 'dark',
  onWorkflowsClick,
  onImportMediaFiles,
  showWorkflows = true,
}) => {
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoInputRef = React.useRef<HTMLInputElement | null>(null);
  const [openMenu, setOpenMenu] = React.useState<ToolbarMenu>(null);
  const [shapeSelection, setShapeSelection] = React.useState('矩形');
  const [activeSlot, setActiveSlot] = React.useState<ToolbarActiveSlot>('tools');
  const isDark = canvasTheme === 'dark';

  // Keyboard / parent: V/H 仍回到「选择/平移」组，主条上恢复与第一个按钮一致的选中
  React.useEffect(() => {
    if (activeTool === 'select' || activeTool === 'hand') {
      setActiveSlot('tools');
    }
  }, [activeTool]);

  const toolbarStyle = {
    '--toolbar-surface': isDark ? '#171612' : '#ffffff',
  } as React.CSSProperties;

  const shellClassName = isDark
    ? 'border-[rgba(245,244,239,0.12)] bg-[#171612]/95 text-[#e8e6e0] shadow-[0_2px_24px_rgba(0,0,0,0.35)] backdrop-blur-md'
    : 'border border-[rgba(26,26,25,0.08)] bg-white text-[#1A1A1A] shadow-[0_2px_20px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.04)]';

  const runFileImport = React.useCallback((files: FileList | null) => {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length > 0) {
      onImportMediaFiles?.(selectedFiles);
    }
  }, [onImportMediaFiles]);

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          runFileImport(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          runFileImport(event.target.files);
          event.target.value = '';
        }}
      />

      <div
        style={toolbarStyle}
        className={`pointer-events-auto flex min-h-0 items-center gap-0.5 rounded-[20px] px-1.5 py-1.5 ${shellClassName}`}
        onMouseLeave={() => setOpenMenu(null)}
      >
        <div className="relative" onMouseEnter={() => setOpenMenu('tools')}>
          {openMenu === 'tools' ? (
            <MenuShell isDark={isDark} className="left-[-20px] w-[220px]">
              <MenuItem
                isDark={isDark}
                active={activeTool === 'select'}
                icon={<MousePointer2 {...ti} />}
                label="选择"
                shortcut="V"
                onClick={() => {
                  setActiveSlot('tools');
                  onToolChange('select');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={activeTool === 'hand'}
                icon={<Hand {...ti} />}
                label="平移画布"
                shortcut="H"
                onClick={() => {
                  setActiveSlot('tools');
                  onToolChange('hand');
                  setOpenMenu(null);
                }}
              />
            </MenuShell>
          ) : null}
          <ToolbarButton
            isDark={isDark}
            label={activeTool === 'hand' ? '平移画布' : '选择'}
            active={activeSlot === 'tools'}
            onClick={() => {
              setActiveSlot('tools');
              onToolChange('select');
            }}
          >
            {activeTool === 'hand' ? <Hand {...ti} /> : <MousePointer2 {...ti} />}
          </ToolbarButton>
        </div>

        <ToolbarButton
          isDark={isDark}
          label="标记"
          shortcut="M"
          showTooltip
          active={activeSlot === 'pin'}
          onClick={() => setActiveSlot('pin')}
        >
          <MapPin {...ti} />
        </ToolbarButton>

        <div className="relative" onMouseEnter={() => setOpenMenu('upload')}>
          {openMenu === 'upload' ? (
            <MenuShell isDark={isDark} className="left-[-48px] w-[132px]">
              <MenuItem
                isDark={isDark}
                icon={<ImageUp {...ti} />}
                label="上传图片"
                onClick={() => {
                  setActiveSlot('upload');
                  setOpenMenu(null);
                  imageInputRef.current?.click();
                }}
              />
              <MenuItem
                isDark={isDark}
                icon={<Video {...ti} />}
                label="上传视频"
                onClick={() => {
                  setActiveSlot('upload');
                  setOpenMenu(null);
                  videoInputRef.current?.click();
                }}
              />
            </MenuShell>
          ) : null}
          <ToolbarButton
            isDark={isDark}
            label="上传"
            active={activeSlot === 'upload'}
            onClick={() => {
              setActiveSlot('upload');
              setOpenMenu(openMenu === 'upload' ? null : 'upload');
            }}
          >
            <ImageUp {...ti} />
          </ToolbarButton>
        </div>

        {showWorkflows && onWorkflowsClick ? (
          <ToolbarButton
            isDark={isDark}
            label="智能画板"
            shortcut="F"
            showTooltip
            active={activeSlot === 'workflows'}
            onClick={(e) => {
              setActiveSlot('workflows');
              onWorkflowsClick(e);
            }}
          >
            <Hash {...ti} />
          </ToolbarButton>
        ) : (
          <ToolbarButton
            isDark={isDark}
            label="智能画板"
            shortcut="F"
            showTooltip
            active={activeSlot === 'workflows'}
            onClick={() => setActiveSlot('workflows')}
          >
            <Hash {...ti} />
          </ToolbarButton>
        )}

        <div className="relative" onMouseEnter={() => setOpenMenu('shapes')}>
          {openMenu === 'shapes' ? (
            <MenuShell isDark={isDark} className="left-[-88px] w-[200px]">
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '矩形'}
                icon={<ShapeMenuIcon shape="矩形" />}
                label="矩形"
                shortcut="R"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('矩形');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '线条'}
                icon={<ShapeMenuIcon shape="线条" />}
                label="线条"
                shortcut="L"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('线条');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '箭头'}
                icon={<ShapeMenuIcon shape="箭头" />}
                label="箭头"
                shortcut="⇧ L"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('箭头');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '椭圆'}
                icon={<ShapeMenuIcon shape="椭圆" />}
                label="椭圆"
                shortcut="O"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('椭圆');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '多边形'}
                icon={<ShapeMenuIcon shape="多边形" />}
                label="多边形"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('多边形');
                  setOpenMenu(null);
                }}
              />
              <MenuItem
                isDark={isDark}
                active={shapeSelection === '星形'}
                icon={<ShapeMenuIcon shape="星形" />}
                label="星形"
                onClick={() => {
                  setActiveSlot('shapes');
                  setShapeSelection('星形');
                  setOpenMenu(null);
                }}
              />
            </MenuShell>
          ) : null}
          <ToolbarButton
            isDark={isDark}
            label="形状"
            active={activeSlot === 'shapes'}
            onClick={() => {
              setActiveSlot('shapes');
              setOpenMenu(openMenu === 'shapes' ? null : 'shapes');
            }}
          >
            <ShapeMenuIcon shape={shapeSelection} size={TOOL_ICON_SIZE} />
          </ToolbarButton>
        </div>

        <ToolbarButton
          isDark={isDark}
          label="铅笔"
          shortcut="P"
          showTooltip
          active={activeSlot === 'pen'}
          onClick={() => setActiveSlot('pen')}
        >
          <PenLine {...ti} />
        </ToolbarButton>

        <ToolbarButton
          isDark={isDark}
          label="文字"
          shortcut="T"
          showTooltip
          active={activeSlot === 'text'}
          onClick={() => {
            setActiveSlot('text');
            onAddText();
          }}
        >
          <Type {...ti} />
        </ToolbarButton>

        <Separator isDark={isDark} />

        <ToolbarButton
          isDark={isDark}
          label="图像生成器"
          shortcut="A"
          showTooltip
          active={activeSlot === 'aiImage'}
          onClick={() => {
            setActiveSlot('aiImage');
            onAddImage();
          }}
        >
          <SparkleBadgeIcon type="image" />
        </ToolbarButton>

        <ToolbarButton
          isDark={isDark}
          label="视频生成器"
          shortcut="S"
          showTooltip
          active={activeSlot === 'aiVideo'}
          onClick={() => {
            setActiveSlot('aiVideo');
            onAddVideo();
          }}
        >
          <SparkleBadgeIcon type="video" />
        </ToolbarButton>

        <ToolbarButton
          isDark={isDark}
          label="字体生成器"
          showTooltip
          active={activeSlot === 'aiText'}
          onClick={() => {
            setActiveSlot('aiText');
            onAddText();
          }}
        >
          <SparkleBadgeIcon type="text" />
        </ToolbarButton>
      </div>
    </div>
  );
};
