import React from 'react';

interface TopBarProps {
  canvasTitle: string;
  isEditingTitle: boolean;
  editingTitleValue: string;
  canvasTitleInputRef: React.RefObject<HTMLInputElement | null>;
  setCanvasTitle: (title: string) => void;
  setIsEditingTitle: (editing: boolean) => void;
  setEditingTitleValue: (value: string) => void;
  onNew: () => void;
  hasUnsavedChanges: boolean;
  onNavigateHome: () => void;
  onOpenProjectLibrary: () => void;
  onDeleteCurrentProject: () => void | Promise<void>;
  canDeleteCurrentProject: boolean;
  onImportImage: (file: File) => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCopy: () => void;
  canCopy: boolean;
  onFitCanvas: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canvasTheme?: 'dark' | 'light';
}

interface DropdownItemProps {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  isDark: boolean;
  onClick?: () => void | Promise<void>;
}

const DropdownItem: React.FC<DropdownItemProps> = ({
  label,
  shortcut,
  disabled = false,
  isDark,
  onClick,
}) => (
  <button
    type="button"
    onClick={() => {
      if (!disabled) {
        void onClick?.();
      }
    }}
    disabled={disabled}
    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] leading-5 transition-colors ${
      disabled
        ? isDark
          ? 'cursor-not-allowed text-[#5f5d57]'
          : 'cursor-not-allowed text-[#c9c7c0]'
        : isDark
          ? 'text-[#f5f4ef] hover:bg-[#2a2822]'
          : 'text-[#1f1f1f] hover:bg-[#f5f4f1]'
    }`}
  >
    <span className="font-medium">{label}</span>
    {shortcut ? (
      <span
        className={`ml-6 text-[13px] ${
          disabled
            ? isDark ? 'text-[#4d4b45]' : 'text-[#d8d6d0]'
            : isDark ? 'text-[#7d786d]' : 'text-[#b7b3aa]'
        }`}
      >
        {shortcut}
      </span>
    ) : null}
  </button>
);

export const TopBar: React.FC<TopBarProps> = ({
  canvasTitle,
  isEditingTitle,
  editingTitleValue,
  canvasTitleInputRef,
  setCanvasTitle,
  setIsEditingTitle,
  setEditingTitleValue,
  onNew,
  hasUnsavedChanges,
  onNavigateHome,
  onOpenProjectLibrary,
  onDeleteCurrentProject,
  canDeleteCurrentProject,
  onImportImage,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onCopy,
  canCopy,
  onFitCanvas,
  onZoomIn,
  onZoomOut,
  canvasTheme = 'dark',
}) => {
  const menuRootRef = React.useRef<HTMLDivElement>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [isDeletingProject, setIsDeletingProject] = React.useState(false);
  const isDark = canvasTheme === 'dark';
  const logoButtonClassName = isDark
    ? 'bg-[#171612] hover:bg-[#24221d] focus-visible:outline-white/30'
    : 'bg-[#f9f8f6] hover:bg-white focus-visible:outline-black/20';
  const titleButtonClassName = isDark
    ? 'text-[#f5f4ef] focus-visible:outline-white/30 hover:bg-[#2a2822]'
    : 'text-[#100f09] focus-visible:outline-black/20 hover:bg-[#e8e8e8]';
  const titleTextClassName = isDark
    ? 'text-[#f5f4ef] group-hover:decoration-[#9c9688]'
    : 'text-[#100f09] group-hover:decoration-neutral-500';
  const titleInputClassName = isDark
    ? 'border-[#3a372f] bg-[#171612] text-[#f5f4ef] caret-[#f5f4ef] placeholder:text-[#777268]'
    : 'border-neutral-200 bg-white text-[#100f09] caret-[#100f09] placeholder:text-neutral-400';
  const menuClassName = isDark
    ? 'border-[#343128] bg-[#171612] shadow-[0_18px_42px_rgba(0,0,0,0.42)]'
    : 'border-[#e8e8e8] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.1)]';
  const dividerClassName = isDark ? 'bg-[#302d25]' : 'bg-[#ebe8df]';

  React.useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen]);

  const commitTitle = React.useCallback(() => {
    const nextTitle = editingTitleValue.trim() || 'Untitled';
    setCanvasTitle(nextTitle);
    setEditingTitleValue(nextTitle);
    setIsEditingTitle(false);
  }, [editingTitleValue, setCanvasTitle, setEditingTitleValue, setIsEditingTitle]);

  const cancelTitleEdit = React.useCallback(() => {
    const nextTitle = canvasTitle || 'Untitled';
    setEditingTitleValue(nextTitle);
    setIsEditingTitle(false);
  }, [canvasTitle, setEditingTitleValue, setIsEditingTitle]);

  const openTitleEditor = React.useCallback(() => {
    setEditingTitleValue(canvasTitle || 'Untitled');
    setIsEditingTitle(true);
  }, [canvasTitle, setEditingTitleValue, setIsEditingTitle]);

  const confirmDiscardChanges = React.useCallback((message: string) => {
    if (!hasUnsavedChanges) {
      return true;
    }
    return window.confirm(message);
  }, [hasUnsavedChanges]);

  const runMenuAction = React.useCallback(async (action: () => void | Promise<void>) => {
    setIsMenuOpen(false);
    await action();
  }, []);

  const handleNavigateHome = React.useCallback(() => {
    if (!confirmDiscardChanges('当前画布有未保存的修改，确认离开并返回主页吗？')) {
      return;
    }
    onNavigateHome();
  }, [confirmDiscardChanges, onNavigateHome]);

  const handleOpenProjectLibrary = React.useCallback(() => {
    if (!confirmDiscardChanges('当前画布有未保存的修改，确认离开并前往项目库吗？')) {
      return;
    }
    onOpenProjectLibrary();
  }, [confirmDiscardChanges, onOpenProjectLibrary]);

  const handleNewProject = React.useCallback(() => {
    if (!confirmDiscardChanges('当前画布有未保存的修改，确认新建项目吗？')) {
      return;
    }
    onNew();
  }, [confirmDiscardChanges, onNew]);

  const handleDeleteProject = React.useCallback(async () => {
    if (!canDeleteCurrentProject || isDeletingProject) {
      return;
    }
    const shouldDelete = window.confirm('确认删除当前项目吗？删除后无法恢复。');
    if (!shouldDelete) {
      return;
    }
    try {
      setIsDeletingProject(true);
      await onDeleteCurrentProject();
    } finally {
      setIsDeletingProject(false);
    }
  }, [canDeleteCurrentProject, isDeletingProject, onDeleteCurrentProject]);

  const handleImportButtonClick = React.useCallback(() => {
    setIsMenuOpen(false);
    importInputRef.current?.click();
  }, []);

  const handleImportChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await onImportImage(file);
  }, [onImportImage]);

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-[70]">
      <div ref={menuRootRef} className="pointer-events-auto relative flex h-8 items-center gap-2">
        <input
          ref={importInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImportChange}
        />

        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-0 p-0 shadow-none transition-colors hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${logoButtonClassName}`}
          aria-label="Open canvas menu"
          aria-expanded={isMenuOpen}
        >
          <img
            src="/chuangjing-logo-shell.png"
            alt=""
            className="h-full w-full object-contain p-1.5"
            draggable={false}
          />
        </button>

        <div className="flex min-h-8 min-w-[72px] max-w-[220px] items-center self-stretch">
          {isEditingTitle ? (
            <input
              ref={canvasTitleInputRef}
              value={editingTitleValue}
              onChange={(event) => setEditingTitleValue(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitTitle();
                } else if (event.key === 'Escape') {
                  cancelTitleEdit();
                }
              }}
              className={`w-full min-w-0 rounded px-1.5 py-0.5 text-left text-[14px] font-bold leading-6 shadow-none outline-none ring-0 transition ${titleInputClassName}`}
              spellCheck={false}
            />
          ) : (
            <button
              type="button"
              onClick={openTitleEditor}
              className={`group -my-0.5 max-w-full rounded-sm border-0 bg-transparent px-0.5 py-0.5 text-left text-[14px] font-bold leading-6 antialiased outline-none transition-all duration-150 ease-out [filter:none] [text-shadow:none] hover:rounded-md hover:px-2.5 hover:py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${titleButtonClassName}`}
              title="Rename canvas"
            >
              <span className={`block truncate [text-shadow:none] group-hover:underline group-hover:decoration-dashed group-hover:underline-offset-4 group-hover:decoration-1 ${titleTextClassName}`}>
                {canvasTitle || 'Untitled'}
              </span>
            </button>
          )}
        </div>

        {isMenuOpen ? (
          <div className={`absolute left-0 top-full z-10 mt-2 w-[224px] rounded-lg border p-2 ${menuClassName}`}>
            <DropdownItem isDark={isDark} label="主页" onClick={() => runMenuAction(handleNavigateHome)} />
            <DropdownItem isDark={isDark} label="项目库" onClick={() => runMenuAction(handleOpenProjectLibrary)} />

            <div className={`my-2 h-px ${dividerClassName}`} />

            <DropdownItem isDark={isDark} label="新建项目" onClick={() => runMenuAction(handleNewProject)} />
            <DropdownItem
              isDark={isDark}
              label={isDeletingProject ? '删除中...' : '删除当前项目'}
              disabled={!canDeleteCurrentProject || isDeletingProject}
              onClick={() => runMenuAction(handleDeleteProject)}
            />

            <div className={`my-2 h-px ${dividerClassName}`} />

            <DropdownItem isDark={isDark} label="导入图片" onClick={handleImportButtonClick} />

            <div className={`my-2 h-px ${dividerClassName}`} />

            <DropdownItem isDark={isDark} label="撤销" shortcut="⌘ Z" disabled={!canUndo} onClick={() => runMenuAction(onUndo)} />
            <DropdownItem isDark={isDark} label="重做" shortcut="⌘ ⇧ Z" disabled={!canRedo} onClick={() => runMenuAction(onRedo)} />
            <DropdownItem isDark={isDark} label="复制对象" shortcut="⌘ D" disabled={!canCopy} onClick={() => runMenuAction(onCopy)} />

            <div className={`my-2 h-px ${dividerClassName}`} />

            <DropdownItem isDark={isDark} label="显示画布所有元素" shortcut="⇧ 1" onClick={() => runMenuAction(onFitCanvas)} />
            <DropdownItem isDark={isDark} label="放大" shortcut="⌘ +" onClick={() => runMenuAction(onZoomIn)} />
            <DropdownItem isDark={isDark} label="缩小" shortcut="⌘ -" onClick={() => runMenuAction(onZoomOut)} />
          </div>
        ) : null}
      </div>
    </div>
  );
};
