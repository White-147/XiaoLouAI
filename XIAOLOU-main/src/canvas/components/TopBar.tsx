/**
 * TopBar.tsx
 * 
 * Top navigation bar component with canvas title, save button, and other controls.
 */

import React, { useState } from 'react';
import { Plus, Save, Loader2 } from 'lucide-react';

interface TopBarProps {
    // Title
    canvasTitle: string;
    isEditingTitle: boolean;
    editingTitleValue: string;
    canvasTitleInputRef: React.RefObject<HTMLInputElement>;
    setCanvasTitle: (title: string) => void;
    setIsEditingTitle: (editing: boolean) => void;
    setEditingTitleValue: (value: string) => void;
    // Actions
    onSave: () => void | Promise<void>;
    onNew: () => void;
    hasUnsavedChanges: boolean;
    lastAutoSaveTime?: number;
    // Layout
    isChatOpen?: boolean;
    // Theme
    canvasTheme: 'dark' | 'light';
    onToggleTheme: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    onSave,
    onNew,
    hasUnsavedChanges,
    lastAutoSaveTime,
    isChatOpen = false,
    canvasTheme,
    onToggleTheme,
    ..._titleProps
}) => {
    void _titleProps;
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleNewClick = () => {
        if (hasUnsavedChanges) {
            setShowNewConfirm(true);
        } else {
            onNew();
        }
    };

    const handleSaveAndNew = async () => {
        try {
            setIsSaving(true);
            await onSave();
            setShowNewConfirm(false);
            onNew();
        } catch (error) {
            console.error("Failed to save and new:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscardAndNew = () => {
        setShowNewConfirm(false);
        onNew();
    };

    return (
        <>
            <div
                className="fixed top-0 left-0 h-14 flex items-center justify-end px-6 z-50 pointer-events-none transition-all duration-300"
                style={{ width: isChatOpen ? 'calc(100% - 400px)' : '100%' }}
            >
                <div className="flex items-center gap-3 pointer-events-auto">
                    {/* Auto-save notification - before save button */}
                    {lastAutoSaveTime && !hasUnsavedChanges && (
                        <div className={`text-[10px] font-medium px-2 py-1 rounded border animate-in fade-in duration-500 ${canvasTheme === 'dark'
                            ? 'text-neutral-500 border-neutral-800'
                            : 'text-neutral-400 border-neutral-100'
                            }`}>
                            已自动保存 {new Date(lastAutoSaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                    <button
                        onClick={() => onSave()}
                        className={`text-sm px-5 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-[#2e2e2e] hover:bg-[#3b3b3b] text-[#f5f4ef] border-[rgba(245,244,239,0.12)]'   /* Lovart Mantine dark-6 + border-l2 */
                            : 'bg-[#eae9e6] hover:bg-[#dfe0e1] text-[#100f09] border-[rgba(26,26,25,0.12)] shadow-sm' /* Lovart light-tertiary + border-l2 */
                            }`}
                    >
                        <Save size={16} />
                        保存
                    </button>
                    <button
                        onClick={handleNewClick}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-[#2e2e2e] hover:bg-[#3b3b3b] text-[#f5f4ef] border-[rgba(245,244,239,0.12)]'
                            : 'bg-[#eae9e6] hover:bg-[#dfe0e1] text-[#100f09] border-[rgba(26,26,25,0.12)]'
                            }`}
                    >
                        <Plus size={16} />
                        新建
                    </button>
                </div>
            </div>

            {/* Unsaved Changes Confirmation Modal */}
            {showNewConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
                    <div className="bg-[#171612] border border-[rgba(245,244,239,0.12)] rounded-2xl p-6 w-[400px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-[#f5f4ef] mb-2">有未保存的更改</h3>
                        <p className="text-[#929290] text-sm mb-6">
                            当前画布有未保存的更改，是否在新建前先保存？
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowNewConfirm(false)}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-[#2e2e2e] hover:bg-[#3b3b3b] text-[#f5f4ef] border border-[rgba(245,244,239,0.12)] text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDiscardAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                不保存
                            </button>
                            <button
                                onClick={handleSaveAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        保存中...
                                    </>
                                ) : (
                                    '保存并新建'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
