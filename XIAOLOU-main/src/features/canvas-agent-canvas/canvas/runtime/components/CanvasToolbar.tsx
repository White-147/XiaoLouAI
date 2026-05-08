import React from 'react';
import {
  MousePointer2,
  Hand,
  Type,
  Image as ImageIcon,
  Film,
  LayoutGrid,
  FolderOpen,
  History,
  Plus,
  Minus,
} from 'lucide-react';

export type CanvasTool = 'select' | 'hand';

interface ToolButtonProps {
  active?: boolean;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  shortcut?: string;
  children: React.ReactNode;
  activeClassName: string;
  inactiveClassName: string;
  activeHoverClassName: string;
}

const ToolButton: React.FC<ToolButtonProps> = ({
  active,
  onClick,
  title,
  shortcut,
  children,
  activeClassName,
  inactiveClassName,
  activeHoverClassName,
}) => (
  <button
    type="button"
    aria-label={title}
    className={`
      relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150
      ${active ? activeClassName : inactiveClassName}
      ${active ? '' : activeHoverClassName}
    `}
    onClick={onClick}
    title={shortcut ? `${title} (${shortcut})` : title}
  >
    {children}
    {shortcut && (
      <span
        className={`absolute -bottom-0.5 right-0.5 text-[8px] leading-none font-medium ${
          active ? 'opacity-60' : 'opacity-40'
        }`}
      >
        {shortcut}
      </span>
    )}
  </button>
);

const Separator: React.FC<{ className: string }> = ({ className }) => (
  <div className={`mx-0.5 h-6 w-[1px] flex-shrink-0 ${className}`} />
);

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
  showWorkflows?: boolean;
  showAssets?: boolean;
  showHistory?: boolean;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  activeTool,
  onToolChange,
  onAddText,
  onAddImage,
  onAddVideo,
  zoom,
  onZoomChange,
  canvasTheme = 'dark',
  onWorkflowsClick,
  onAssetsClick,
  onHistoryClick,
  showWorkflows = true,
  showAssets = true,
  showHistory = true,
}) => {
  const isDark = canvasTheme === 'dark';

  const bgClass = isDark
    ? 'bg-[#171612]/95 backdrop-blur-md border-[rgba(245,244,239,0.12)]'
    : 'bg-[#f9f8f6]/95 backdrop-blur-md border-[rgba(26,26,25,0.08)]';

  const activeBg = isDark ? 'bg-white/15' : 'bg-[#100f09]/10';
  const hoverBg = isDark ? 'hover:bg-white/8' : 'hover:bg-[#100f09]/5';
  const textColor = isDark ? 'text-[#929290]' : 'text-[#7c7c79]';
  const activeTextColor = isDark ? 'text-[#f5f4ef]' : 'text-[#100f09]';
  const separatorColor = isDark ? 'bg-[rgba(245,244,239,0.12)]' : 'bg-[rgba(26,26,25,0.08)]';
  const activeButtonClassName = `${activeBg} ${activeTextColor}`;
  const inactiveButtonClassName = `${textColor} ${hoverBg}`;
  const inactiveHoverClassName = `hover:${activeTextColor}`;

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="absolute bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5">
      <div className={`flex items-center gap-0.5 rounded-xl border px-1.5 py-1.5 shadow-2xl ${bgClass}`}>
        <ToolButton
          active={activeTool === 'select'}
          onClick={() => onToolChange('select')}
          title="Select tool"
          shortcut="V"
          activeClassName={activeButtonClassName}
          inactiveClassName={inactiveButtonClassName}
          activeHoverClassName={inactiveHoverClassName}
        >
          <MousePointer2 size={18} />
        </ToolButton>

        <ToolButton
          active={activeTool === 'hand'}
          onClick={() => onToolChange('hand')}
          title="Pan canvas"
          shortcut="H"
          activeClassName={activeButtonClassName}
          inactiveClassName={inactiveButtonClassName}
          activeHoverClassName={inactiveHoverClassName}
        >
          <Hand size={18} />
        </ToolButton>

        <Separator className={separatorColor} />

        <ToolButton
          onClick={onAddText}
          title="Add text node"
          shortcut="T"
          activeClassName={activeButtonClassName}
          inactiveClassName={inactiveButtonClassName}
          activeHoverClassName={inactiveHoverClassName}
        >
          <Type size={18} />
        </ToolButton>

        <ToolButton
          onClick={onAddImage}
          title="Add image node"
          shortcut="I"
          activeClassName={activeButtonClassName}
          inactiveClassName={inactiveButtonClassName}
          activeHoverClassName={inactiveHoverClassName}
        >
          <ImageIcon size={18} />
        </ToolButton>

        <ToolButton
          onClick={onAddVideo}
          title="Add video node"
          activeClassName={activeButtonClassName}
          inactiveClassName={inactiveButtonClassName}
          activeHoverClassName={inactiveHoverClassName}
        >
          <Film size={18} />
        </ToolButton>

        <Separator className={separatorColor} />

        {showWorkflows && onWorkflowsClick && (
          <ToolButton
            onClick={onWorkflowsClick}
            title="Workflows"
            activeClassName={activeButtonClassName}
            inactiveClassName={inactiveButtonClassName}
            activeHoverClassName={inactiveHoverClassName}
          >
            <LayoutGrid size={18} />
          </ToolButton>
        )}
        {showAssets && onAssetsClick && (
          <ToolButton
            onClick={onAssetsClick}
            title="Asset library"
            activeClassName={activeButtonClassName}
            inactiveClassName={inactiveButtonClassName}
            activeHoverClassName={inactiveHoverClassName}
          >
            <FolderOpen size={18} />
          </ToolButton>
        )}
        {showHistory && onHistoryClick && (
          <ToolButton
            onClick={onHistoryClick}
            title="History"
            activeClassName={activeButtonClassName}
            inactiveClassName={inactiveButtonClassName}
            activeHoverClassName={inactiveHoverClassName}
          >
            <History size={18} />
          </ToolButton>
        )}
      </div>

      <div className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 shadow-2xl ${bgClass}`}>
        <button
          type="button"
          aria-label="Zoom out"
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${textColor} ${hoverBg}`}
          onClick={() => onZoomChange(Math.max(0.1, zoom - 0.1))}
          title="Zoom out"
        >
          <Minus size={14} />
        </button>
        <span className={`w-10 text-center text-xs font-medium tabular-nums ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${textColor} ${hoverBg}`}
          onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}
          title="Zoom in"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};
