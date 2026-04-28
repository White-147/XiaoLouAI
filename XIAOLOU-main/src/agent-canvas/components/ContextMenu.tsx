import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Type,
  Image as ImageIcon,
  Video,
  Film,
  Upload,
  Trash2,
  Plus,
  Undo2,
  Redo2,
  Clipboard,
  Copy,
  Files,
  Layers,
  ChevronRight,
  HardDrive,
  PenTool,
} from 'lucide-react';
import { ContextMenuState, NodeType } from '../types';

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSelectType: (type: NodeType | 'DELETE') => void;
  onUpload: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onCreateAsset?: () => void;
  onAddAssets?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canvasTheme?: 'dark' | 'light';
  allowTextNodes?: boolean;
  allowImageNodes?: boolean;
  allowVideoNodes?: boolean;
  allowImageEditorNodes?: boolean;
  allowVideoEditorNodes?: boolean;
  allowLocalModels?: boolean;
}

const VIEWPORT_PADDING = 12;
const NODE_OPTIONS_MENU_WIDTH = 192;
const NODE_OPTIONS_MENU_HEIGHT = 248;
const GLOBAL_MENU_WIDTH = 256;
const GLOBAL_MENU_HEIGHT = 360;
const ADD_NODES_MENU_WIDTH = 256;
const ADD_NODES_MENU_HEIGHT = 432;

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === 'undefined') {
    return { left: x, top: y };
  }

  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, x), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, y), maxTop),
  };
}

function getSubmenuPosition(
  anchorRect: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
) {
  if (typeof window === 'undefined') {
    return { left: anchorRect.right, top: anchorRect.top };
  }

  const preferredRightLeft = anchorRect.right - 2;
  const preferredLeftLeft = anchorRect.left - width + 2;
  const canPlaceRight = preferredRightLeft + width + VIEWPORT_PADDING <= window.innerWidth;
  const left = canPlaceRight
    ? preferredRightLeft
    : Math.max(VIEWPORT_PADDING, preferredLeftLeft);

  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
  const top = Math.min(Math.max(VIEWPORT_PADDING, anchorRect.top), maxTop);
  return { left, top };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  onClose,
  onSelectType,
  onUpload,
  onUndo,
  onRedo,
  onPaste,
  onCopy,
  onDuplicate,
  onCreateAsset,
  onAddAssets,
  canUndo = false,
  canRedo = false,
  canvasTheme = 'dark',
  allowTextNodes = true,
  allowImageNodes = true,
  allowVideoNodes = true,
  allowImageEditorNodes = true,
  allowVideoEditorNodes = true,
  allowLocalModels = true,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const addNodesTriggerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submenuCloseTimerRef = useRef<number | null>(null);

  const [isAddNodesPinned, setIsAddNodesPinned] = useState(false);
  const [isAddNodesTriggerHovered, setIsAddNodesTriggerHovered] = useState(false);
  const [isAddNodesSubmenuHovered, setIsAddNodesSubmenuHovered] = useState(false);
  const [addNodesAnchorRect, setAddNodesAnchorRect] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  const clearSubmenuCloseTimer = useCallback(() => {
    if (submenuCloseTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(submenuCloseTimerRef.current);
      submenuCloseTimerRef.current = null;
    }
  }, []);

  const scheduleSubmenuClose = useCallback(() => {
    clearSubmenuCloseTimer();
    if (isAddNodesPinned || typeof window === 'undefined') return;
    submenuCloseTimerRef.current = window.setTimeout(() => {
      setIsAddNodesTriggerHovered(false);
      setIsAddNodesSubmenuHovered(false);
    }, 120);
  }, [clearSubmenuCloseTimer, isAddNodesPinned]);

  const updateAddNodesAnchorRect = useCallback(() => {
    const rect = addNodesTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAddNodesAnchorRect({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
  }, []);

  const handleAddNodesMouseEnter = useCallback(() => {
    clearSubmenuCloseTimer();
    updateAddNodesAnchorRect();
    setIsAddNodesTriggerHovered(true);
  }, [clearSubmenuCloseTimer, updateAddNodesAnchorRect]);

  const handleAddNodesMouseLeave = useCallback(() => {
    setIsAddNodesTriggerHovered(false);
    scheduleSubmenuClose();
  }, [scheduleSubmenuClose]);

  const handleAddNodesSubmenuMouseEnter = useCallback(() => {
    clearSubmenuCloseTimer();
    setIsAddNodesSubmenuHovered(true);
  }, [clearSubmenuCloseTimer]);

  const handleAddNodesSubmenuMouseLeave = useCallback(() => {
    setIsAddNodesSubmenuHovered(false);
    scheduleSubmenuClose();
  }, [scheduleSubmenuClose]);

  const handleAddNodesTriggerClick = useCallback(() => {
    clearSubmenuCloseTimer();
    updateAddNodesAnchorRect();
    setIsAddNodesPinned((prev) => !prev);
    setIsAddNodesTriggerHovered(true);
  }, [clearSubmenuCloseTimer, updateAddNodesAnchorRect]);

  const isGlobalAddNodesSubmenuOpen =
    state.type === 'global' && (isAddNodesPinned || isAddNodesTriggerHovered || isAddNodesSubmenuHovered);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideMain = menuRef.current?.contains(target) ?? false;
      const clickedInsideSubmenu = submenuRef.current?.contains(target) ?? false;
      if (!clickedInsideMain && !clickedInsideSubmenu) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    clearSubmenuCloseTimer();
    setIsAddNodesPinned(false);
    setIsAddNodesTriggerHovered(false);
    setIsAddNodesSubmenuHovered(false);
    setAddNodesAnchorRect(null);
    return () => clearSubmenuCloseTimer();
  }, [clearSubmenuCloseTimer, state.isOpen, state.type, state.x, state.y]);

  useEffect(() => {
    if (!isGlobalAddNodesSubmenuOpen || typeof window === 'undefined') return undefined;

    updateAddNodesAnchorRect();
    const handleWindowUpdate = () => updateAddNodesAnchorRect();
    window.addEventListener('resize', handleWindowUpdate);
    window.addEventListener('scroll', handleWindowUpdate, true);
    return () => {
      window.removeEventListener('resize', handleWindowUpdate);
      window.removeEventListener('scroll', handleWindowUpdate, true);
    };
  }, [isGlobalAddNodesSubmenuOpen, updateAddNodesAnchorRect]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      onClose();
    }
    e.target.value = '';
  };

  const handleUndo = () => {
    if (onUndo && canUndo) {
      onUndo();
      onClose();
    }
  };

  const handleRedo = () => {
    if (onRedo && canRedo) {
      onRedo();
      onClose();
    }
  };

  const handlePaste = () => {
    if (onPaste) {
      onPaste();
      onClose();
    }
  };

  if (!state.isOpen || typeof document === 'undefined') return null;

  const isConnector = state.type === 'node-connector';
  const nodeOptionsPosition = clampMenuPosition(state.x, state.y, NODE_OPTIONS_MENU_WIDTH, NODE_OPTIONS_MENU_HEIGHT);
  const globalMenuPosition = clampMenuPosition(state.x, state.y, GLOBAL_MENU_WIDTH, GLOBAL_MENU_HEIGHT);
  const addNodesMenuPosition = clampMenuPosition(state.x, state.y, ADD_NODES_MENU_WIDTH, ADD_NODES_MENU_HEIGHT);
  const addNodesSubmenuPosition = addNodesAnchorRect
    ? getSubmenuPosition(addNodesAnchorRect, ADD_NODES_MENU_WIDTH, ADD_NODES_MENU_HEIGHT)
    : null;

  const addNodesMenuContent = (
    <>
      {allowTextNodes && (
        <MenuItem
          icon={<Type size={18} />}
          label={isConnector ? '文本生成' : '文本'}
          desc={isConnector ? '脚本、广告文案、品牌文案' : undefined}
          onClick={() => onSelectType(NodeType.TEXT)}
          canvasTheme={canvasTheme}
        />
      )}
      {allowImageNodes && (
        <MenuItem
          icon={<ImageIcon size={18} />}
          label={isConnector ? '图像生成' : '图像'}
          desc={isConnector ? undefined : '宣传图、海报、封面'}
          onClick={() => onSelectType(NodeType.IMAGE)}
          canvasTheme={canvasTheme}
        />
      )}
      {allowVideoNodes && (
        <MenuItem
          icon={<Video size={18} />}
          label={isConnector ? '视频生成' : '视频'}
          onClick={() => onSelectType(NodeType.VIDEO)}
          canvasTheme={canvasTheme}
        />
      )}
      {!isConnector && allowImageEditorNodes && (
        <MenuItem
          icon={<PenTool size={18} />}
          label="图像编辑器"
          onClick={() => onSelectType(NodeType.IMAGE_EDITOR)}
          canvasTheme={canvasTheme}
        />
      )}
      {!isConnector && allowVideoEditorNodes && (
        <MenuItem
          icon={<Film size={18} />}
          label="视频编辑器"
          onClick={() => onSelectType(NodeType.VIDEO_EDITOR)}
          canvasTheme={canvasTheme}
        />
      )}
      {allowLocalModels && (
        <>
          <div className={`my-2 border-t mx-2 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
          <div className={`px-2 py-1 text-xs font-medium ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
            本地模型（开源）
          </div>
          <MenuItem
            icon={<HardDrive size={18} />}
            label="本地图像模型"
            desc="使用已下载的开源模型"
            badge="新"
            onClick={() => onSelectType(NodeType.LOCAL_IMAGE_MODEL)}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<HardDrive size={18} />}
            label="本地视频模型"
            desc="AnimateDiff、SVD 等开源模型"
            badge="新"
            onClick={() => onSelectType(NodeType.LOCAL_VIDEO_MODEL)}
            canvasTheme={canvasTheme}
          />
        </>
      )}
    </>
  );

  if (state.type === 'node-options') {
    return createPortal(
      <div
        ref={menuRef}
        data-context-menu-root="node-options"
        style={{
          position: 'fixed',
          left: nodeOptionsPosition.left,
          top: nodeOptionsPosition.top,
          zIndex: 1000,
        }}
        className={`w-48 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'}`}
      >
        <div className="p-1.5 flex flex-col gap-0.5">
          {onCreateAsset && (
            <>
              <MenuItem
                icon={<ImageIcon size={16} />}
                label="生成素材"
                onClick={() => {
                  onCreateAsset();
                  onClose();
                }}
                canvasTheme={canvasTheme}
              />
              <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
            </>
          )}
          <MenuItem
            icon={<Copy size={16} />}
            label="复制"
            shortcut="CtrlC"
            onClick={() => {
              if (onCopy) {
                onCopy();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Clipboard size={16} />}
            label="粘贴"
            shortcut="CtrlV"
            onClick={handlePaste}
            disabled={true}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Files size={16} />}
            label="复制节点"
            onClick={() => {
              if (onDuplicate) {
                onDuplicate();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
          <MenuItem
            icon={<Trash2 size={16} />}
            label="删除"
            shortcut="Del"
            onClick={() => onSelectType('DELETE')}
            canvasTheme={canvasTheme}
          />
        </div>
      </div>,
      document.body,
    );
  }

  if (state.type === 'global') {
    return createPortal(
      <>
        <div
          ref={menuRef}
          data-context-menu-root="global"
          style={{
            position: 'fixed',
            left: globalMenuPosition.left,
            top: globalMenuPosition.top,
            zIndex: 1000,
          }}
          className={`w-64 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'}`}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,video/*"
            onChange={handleFileChange}
          />
          <div className="p-1.5 flex flex-col gap-0.5">
            <MenuItem
              icon={<Upload size={16} />}
              label="上传"
              onClick={handleUploadClick}
              canvasTheme={canvasTheme}
            />
            {onAddAssets && (
              <MenuItem
                icon={<Layers size={16} />}
                label="添加素材"
                onClick={() => {
                  onAddAssets();
                  onClose();
                }}
                canvasTheme={canvasTheme}
              />
            )}
            <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
            <div
              ref={addNodesTriggerRef}
              onMouseEnter={handleAddNodesMouseEnter}
              onMouseLeave={handleAddNodesMouseLeave}
            >
              <MenuItem
                icon={<Plus size={16} />}
                label="添加节点"
                rightSlot={<ChevronRight size={14} className={canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'} />}
                onClick={handleAddNodesTriggerClick}
                active={isGlobalAddNodesSubmenuOpen}
                canvasTheme={canvasTheme}
              />
            </div>
            <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
            <MenuItem
              icon={<Undo2 size={16} />}
              label="撤销"
              shortcut="CtrlZ"
              onClick={handleUndo}
              disabled={!canUndo}
              canvasTheme={canvasTheme}
            />
            <MenuItem
              icon={<Redo2 size={16} />}
              label="重做"
              shortcut="ShiftCtrlZ"
              onClick={handleRedo}
              disabled={!canRedo}
              canvasTheme={canvasTheme}
            />
            <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
            <MenuItem
              icon={<Clipboard size={16} />}
              label="粘贴"
              shortcut="CtrlV"
              onClick={handlePaste}
              canvasTheme={canvasTheme}
            />
          </div>
        </div>

        {isGlobalAddNodesSubmenuOpen && addNodesSubmenuPosition ? (
          <div
            ref={submenuRef}
            data-context-menu-submenu="add-nodes"
            onMouseEnter={handleAddNodesSubmenuMouseEnter}
            onMouseLeave={handleAddNodesSubmenuMouseLeave}
            style={{
              position: 'fixed',
              left: addNodesSubmenuPosition.left,
              top: addNodesSubmenuPosition.top,
              zIndex: 1001,
            }}
            className={`w-64 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'}`}
          >
            <div className={`px-4 py-3 text-sm font-medium border-b ${canvasTheme === 'dark' ? 'text-neutral-400 border-neutral-800' : 'text-neutral-500 border-neutral-100'}`}>
              添加节点
            </div>
            <div className="p-2 flex flex-col gap-1 max-h-[400px] overflow-y-auto">
              {addNodesMenuContent}
            </div>
          </div>
        ) : null}
      </>,
      document.body,
    );
  }

  const title = isConnector ? '从此节点生成' : '添加节点';
  return createPortal(
    <div
      ref={menuRef}
      data-context-menu-root={isConnector ? 'connector' : 'add-nodes'}
      style={{
        position: 'fixed',
        left: addNodesMenuPosition.left,
        top: addNodesMenuPosition.top,
        zIndex: 1000,
      }}
      className={`w-64 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'}`}
    >
      <div className={`px-4 py-3 text-sm font-medium border-b ${canvasTheme === 'dark' ? 'text-neutral-400 border-neutral-800' : 'text-neutral-500 border-neutral-100'}`}>
        {title}
      </div>
      <div className="p-2 flex flex-col gap-1 max-h-[400px] overflow-y-auto">
        {addNodesMenuContent}
      </div>
    </div>,
    document.body,
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  badge?: string;
  shortcut?: string;
  active?: boolean;
  rightSlot?: React.ReactNode;
  disabled?: boolean;
  canvasTheme?: 'dark' | 'light';
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  desc,
  badge,
  shortcut,
  active,
  rightSlot,
  disabled,
  canvasTheme = 'dark',
  onClick,
}) => {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 w-full p-2 rounded-lg text-left transition-colors ${disabled
        ? (canvasTheme === 'dark' ? 'opacity-30' : 'opacity-25')
        : active
          ? (canvasTheme === 'dark' ? 'bg-[#2a2a2a] text-white' : 'bg-neutral-100 text-neutral-900')
          : (canvasTheme === 'dark' ? 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-white' : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900')}`}
    >
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${active
          ? (canvasTheme === 'dark' ? 'bg-[#3a3a3a]' : 'bg-white')
          : (canvasTheme === 'dark' ? 'bg-[#151515] group-hover:bg-[#3a3a3a]' : 'bg-neutral-100 group-hover:bg-white border border-transparent group-hover:border-neutral-200')
          } ${disabled ? 'bg-transparent' : ''}`}
      >
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`font-medium text-sm truncate ${disabled && canvasTheme === 'light' ? 'text-neutral-400' : ''}`}>
            {label}
          </span>
          <div className="flex items-center gap-2">
            {badge ? (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${canvasTheme === 'dark' ? 'bg-neutral-800 text-neutral-400 border-neutral-700' : 'bg-neutral-100 text-neutral-500 border-neutral-200'}`}>
                {badge}
              </span>
            ) : null}
            {shortcut ? (
              <span className={`text-xs font-sans ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                {shortcut}
              </span>
            ) : null}
            {rightSlot}
          </div>
        </div>
        {desc ? (
          <p className={`text-xs mt-0.5 truncate ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
            {desc}
          </p>
        ) : null}
      </div>
    </button>
  );
};
