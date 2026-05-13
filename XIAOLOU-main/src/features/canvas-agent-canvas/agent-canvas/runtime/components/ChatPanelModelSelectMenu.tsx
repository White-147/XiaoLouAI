import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import type { ComposerModelOption } from './chatPanelModelOptions';

type ChatPanelModelSelectMenuProps = {
    options: ComposerModelOption[];
    activeModelId: string;
    isLoadingModelCatalog: boolean;
    getOptionIcon: (option: ComposerModelOption, size?: number, className?: string) => ReactNode;
    onSelect: (option: ComposerModelOption) => void;
};

export function ChatPanelModelSelectMenu({
    options,
    activeModelId,
    isLoadingModelCatalog,
    getOptionIcon,
    onSelect,
}: ChatPanelModelSelectMenuProps) {
    return (
        <div className="absolute bottom-11 right-0 z-50 w-48 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl">
            {options.length > 0 ? (
                options.map((option) => {
                    const selected = option.id === activeModelId;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => onSelect(option)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                        >
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                                {getOptionIcon(option, 15)}
                                <span className="min-w-0 truncate">{option.label}</span>
                            </span>
                            {selected && <Check size={14} className="shrink-0" />}
                        </button>
                    );
                })
            ) : (
                <div className="px-3 py-5 text-center text-sm text-neutral-500">
                    {isLoadingModelCatalog ? '正在加载模型...' : '暂无可用模型'}
                </div>
            )}
        </div>
    );
}
