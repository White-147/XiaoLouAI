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
  Wrench,
  Plus,
  Minus,
} from 'lucide-react';

export type CanvasTool = 'select' | 'hand';

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
    ? 'bg-[#171612]/95 backdrop-blur-md border-[rgba(245,244,239,0.12)]'  /* Lovart dark-secondary + border-l2 */
    : 'bg-[#f9f8f6]/95 backdrop-blur-md border-[rgba(26,26,25,0.08)]';    /* Lovart light-default + border-l1 */

  const activeBg = isDark ? 'bg-white/15' : 'bg-[#100f09]/10';
  const hoverBg = isDark ? 'hover:bg-white/8' : 'hover:bg-[#100f09]/5';
  const textColor = isDark ? 'text-[#929290]' : 'text-[#7c7c79]';       /* Lovart text-tertiary */
  const activeTextColor = isDark ? 'text-[#f5f4ef]' : 'text-[#100f09]'; /* Lovart text-default */
  const separatorColor = isDark ? 'bg-[rgba(245,244,239,0.12)]' : 'bg-[rgba(26,26,25,0.08)]';

  const ToolButton: React.FC<{
    active?: boolean;
    onClick: (e: React.MouseEvent) => void;
    title: string;
    shortcut?: string;
    children: React.ReactNode;
  }> = ({ active, onClick, title, shortcut, children }) => (
    <button
      className={`
        relative w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150
        ${active ? `${activeBg} ${activeTextColor}` : `${textColor} ${hoverBg}`}
        ${active ? '' : `hover:${activeTextColor}`}
      `}
      onClick={onClick}
      title={shortcut ? `${title} (${shortcut})` : title}
    >
      {children}
      {shortcut && (
        <span className={`absolute -bottom-0.5 right-0.5 text-[8px] leading-none font-medium ${active ? 'opacity-60' : 'opacity-40'}`}>
          {shortcut}
        </span>
      )}
    </button>
  );

  const Separator = () => (
    <div className={`w-[1px] h-6 ${separatorColor} mx-0.5 flex-shrink-0`} />
  );

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5">
      {/* Main Tools */}
      <div className={`flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl border shadow-2xl ${bgClass}`}>
        {/* Select & Hand */}
        <ToolButton
          active={activeTool === 'select'}
          onClick={() => onToolChange('select')}
          title="选择"
          shortcut="V"
        >
          <MousePointer2 size={18} />
        </ToolButton>

        <ToolButton
          active={activeTool === 'hand'}
          onClick={() => onToolChange('hand')}
          title="画布平移"
          shortcut="H"
        >
          <Hand size={18} />
        </ToolButton>

        <Separator />

        {/* Node Quick-Add */}
        <ToolButton onClick={onAddText} title="添加文本节点" shortcut="T">
          <Type size={18} />
        </ToolButton>

        <ToolButton onClick={onAddImage} title="添加图片节点" shortcut="I">
          <ImageIcon size={18} />
        </ToolButton>

        <ToolButton onClick={onAddVideo} title="添加视频节点">
          <Film size={18} />
        </ToolButton>

        <Separator />

        {/* Secondary tools */}
        {showWorkflows && onWorkflowsClick && (
          <ToolButton onClick={onWorkflowsClick} title="工作流">
            <LayoutGrid size={18} />
          </ToolButton>
        )}
        {showAssets && onAssetsClick && (
          <ToolButton onClick={onAssetsClick} title="素材库">
            <FolderOpen size={18} />
          </ToolButton>
        )}
        {showHistory && onHistoryClick && (
          <ToolButton onClick={onHistoryClick} title="历史记录">
            <History size={18} />
          </ToolButton>
        )}
      </div>

      {/* Zoom Control */}
      <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border shadow-2xl ${bgClass}`}>
        <button
          className={`w-7 h-7 rounded-md flex items-center justify-center ${textColor} ${hoverBg} transition-colors`}
          onClick={() => onZoomChange(Math.max(0.1, zoom - 0.1))}
          title="缩小"
        >
          <Minus size={14} />
        </button>
        <span className={`text-xs w-10 text-center font-medium tabular-nums ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>
          {zoomPercent}%
        </span>
        <button
          className={`w-7 h-7 rounded-md flex items-center justify-center ${textColor} ${hoverBg} transition-colors`}
          onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}
          title="放大"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
};
