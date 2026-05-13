import type { ReactNode } from 'react';
import { Box, Lightbulb, Loader2, Sparkles } from 'lucide-react';

import { ChatPanelComposerActionButton } from './ChatPanelComposerActionButton';
import { ChatPanelModelPreferenceMenu } from './ChatPanelModelPreferenceMenu';
import { ChatPanelModelSelectMenu } from './ChatPanelModelSelectMenu';
import { ChatPanelToolbarTooltip } from './ChatPanelToolbarTooltip';
import type {
    ComposerModelOption,
    ModelPreferenceTab,
} from './chatPanelModelOptions';
import type {
    ComposerMenu,
    ComposerMode,
} from './ChatPanelComposerToolbarTypes';
import type { ComposerActionState } from './useChatPanelComposerAction';

export type ChatPanelComposerToolbarActionsProps = {
    composerMode: ComposerMode;
    activeMenu: ComposerMenu;
    thinkingModeEnabled: boolean;
    activeModelTooltip: string;
    isLoadingModelCatalog: boolean;
    activeModelOptions: ComposerModelOption[];
    activeModelId: string;
    activeModelOption: ComposerModelOption | null | undefined;
    isDark: boolean;
    autoModelPreference: boolean;
    modelPreferenceTab: ModelPreferenceTab;
    modelPreferenceOptions: ComposerModelOption[];
    modelCatalogError: string | null;
    composerAction: ComposerActionState;
    getModelOptionIcon: (option: ComposerModelOption, size?: number, className?: string) => ReactNode;
    isModelPreferenceOptionSelected: (option: ComposerModelOption) => boolean;
    onThinkingClick: () => void;
    onToggleModelMenu: () => void;
    onToggleAutoModelPreference: () => void;
    onModelPreferenceTabChange: (tab: ModelPreferenceTab) => void;
    onModelPreferenceOptionSelect: (option: ComposerModelOption) => void;
    onActiveModelSelect: (option: ComposerModelOption) => void;
    onComposerAction: () => void;
};

export function ChatPanelComposerToolbarActions({
    composerMode,
    activeMenu,
    thinkingModeEnabled,
    activeModelTooltip,
    isLoadingModelCatalog,
    activeModelOptions,
    activeModelId,
    activeModelOption,
    isDark,
    autoModelPreference,
    modelPreferenceTab,
    modelPreferenceOptions,
    modelCatalogError,
    composerAction,
    getModelOptionIcon,
    isModelPreferenceOptionSelected,
    onThinkingClick,
    onToggleModelMenu,
    onToggleAutoModelPreference,
    onModelPreferenceTabChange,
    onModelPreferenceOptionSelect,
    onActiveModelSelect,
    onComposerAction,
}: ChatPanelComposerToolbarActionsProps) {
    return (
        <div className="flex shrink-0 items-center gap-1.5">
            {composerMode === 'agent' && (
                <div className="group relative" data-agent-thinking-menu-root>
                    <button
                        type="button"
                        onClick={onThinkingClick}
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${thinkingModeEnabled ? 'bg-neutral-950 text-white' : 'text-neutral-800 hover:bg-neutral-100'}`}
                        aria-label="思考模式"
                    >
                        <Lightbulb size={16} />
                    </button>
                    <div className="pointer-events-none absolute bottom-10 right-0 z-50 w-36 rounded-lg bg-neutral-950 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        <div className="font-semibold">思考模式</div>
                        <div className="mt-1 text-neutral-300">新建对话</div>
                        <div className="mt-1 leading-4 text-neutral-300">制定复杂任务并自主执行</div>
                    </div>
                </div>
            )}

            <div className="relative" data-agent-active-menu-root>
                <ChatPanelToolbarTooltip label={activeModelTooltip}>
                    <button
                        type="button"
                        onClick={onToggleModelMenu}
                        disabled={isLoadingModelCatalog && activeModelOptions.length === 0}
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${activeMenu === 'model' ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:bg-neutral-100'}`}
                        aria-label="选择模型"
                    >
                        {isLoadingModelCatalog && activeModelOptions.length === 0 ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : composerMode === 'agent' ? (
                            <Box size={16} />
                        ) : activeModelOption ? (
                            getModelOptionIcon(
                                activeModelOption,
                                16,
                                `shrink-0 ${activeMenu === 'model' ? 'text-white' : 'text-neutral-800'}`,
                            )
                        ) : (
                            <Sparkles size={16} />
                        )}
                    </button>
                </ChatPanelToolbarTooltip>

                {activeMenu === 'model' && composerMode === 'agent' && (
                    <ChatPanelModelPreferenceMenu
                        isDark={isDark}
                        autoModelPreference={autoModelPreference}
                        modelPreferenceTab={modelPreferenceTab}
                        options={modelPreferenceOptions}
                        modelCatalogError={modelCatalogError}
                        isLoadingModelCatalog={isLoadingModelCatalog}
                        getOptionIcon={getModelOptionIcon}
                        isOptionSelected={isModelPreferenceOptionSelected}
                        onToggleAutoPreference={onToggleAutoModelPreference}
                        onTabChange={onModelPreferenceTabChange}
                        onOptionSelect={onModelPreferenceOptionSelect}
                    />
                )}

                {activeMenu === 'model' && composerMode !== 'agent' && (
                    <ChatPanelModelSelectMenu
                        options={activeModelOptions}
                        activeModelId={activeModelId}
                        isLoadingModelCatalog={isLoadingModelCatalog}
                        getOptionIcon={getModelOptionIcon}
                        onSelect={onActiveModelSelect}
                    />
                )}
            </div>

            <ChatPanelToolbarTooltip label={composerAction.tooltip}>
                <ChatPanelComposerActionButton
                    action={composerAction}
                    onClick={onComposerAction}
                />
            </ChatPanelToolbarTooltip>
        </div>
    );
}
