import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import {
    MODEL_PREFERENCE_TABS,
    type ComposerModelOption,
    type ModelPreferenceTab,
} from './chatPanelModelOptions';

type ChatPanelModelPreferenceMenuProps = {
    isDark: boolean;
    autoModelPreference: boolean;
    modelPreferenceTab: ModelPreferenceTab;
    options: ComposerModelOption[];
    modelCatalogError: string | null;
    isLoadingModelCatalog: boolean;
    getOptionIcon: (option: ComposerModelOption, size?: number, className?: string) => ReactNode;
    isOptionSelected: (option: ComposerModelOption) => boolean;
    onToggleAutoPreference: () => void;
    onTabChange: (tab: ModelPreferenceTab) => void;
    onOptionSelect: (option: ComposerModelOption) => void;
};

function SwitchIndicator({ checked, theme = 'light' }: { checked: boolean; theme?: 'light' | 'dark' }) {
    if (theme === 'dark') {
        return (
            <span
                className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    checked
                        ? 'justify-end bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                        : 'justify-start bg-white/10 ring-1 ring-inset ring-white/20'
                }`}
                aria-hidden="true"
            >
                <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
            </span>
        );
    }
    return (
        <span
            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-neutral-900' : 'justify-start bg-neutral-200'}`}
            aria-hidden="true"
        >
            <span className="h-4 w-4 rounded-full bg-white shadow" />
        </span>
    );
}

function modelOptionDescription(option: ComposerModelOption) {
    if (option.kind === 'image') {
        if (option.label.includes('Gemini')) return '小楼 Vertex / Gemini 图像生成能力。';
        if (option.label.includes('Seedream')) return '豆包图像生成，适合高质量创意图。';
        if (option.label.includes('Kling')) return '可灵图像生成工具。';
        return '图像生成工具。';
    }

    if (option.kind === 'video') {
        if (option.label.includes('Seedance')) return 'ByteDance 视频模型，适合图生视频和创意短片。';
        if (option.label.includes('Veo')) return 'Google Veo 视频模型，适合高质量视频生成。';
        if (option.label.includes('PixVerse')) return 'PixVerse 视频模型，适合快速生成视频。';
        if (option.label.includes('Kling') || option.label.includes('kling')) return '可灵视频模型，适合多图和元素视频生成。';
        return '视频生成工具。';
    }

    if (option.kind === 'text') {
        if (option.id === 'qwen3.6-plus') return '文本推理与长任务规划模型，适合复杂 Agent 步骤拆解。';
        if (option.id === 'vertex:gemini-3-flash-preview') return 'Gemini 3 文本推理模型，适合快速规划和多模态上下文理解。';
        if (option.id === 'qwen-plus') return '通义千问文本模型，适合稳定的中文 Agent 规划。';
    }

    return '当前模式可用模型。';
}

function modelOptionTime(option: ComposerModelOption) {
    if (option.kind === 'video') {
        if (option.label.includes('Fast')) return '200s';
        if (option.label.includes('Veo')) return '180s';
        return '300s';
    }
    if (option.kind === 'image') return '30s';
    return '';
}

export function ChatPanelModelPreferenceMenu({
    isDark,
    autoModelPreference,
    modelPreferenceTab,
    options,
    modelCatalogError,
    isLoadingModelCatalog,
    getOptionIcon,
    isOptionSelected,
    onToggleAutoPreference,
    onTabChange,
    onOptionSelect,
}: ChatPanelModelPreferenceMenuProps) {
    const title = MODEL_PREFERENCE_TABS.find((tabItem) => tabItem.value === modelPreferenceTab)?.label || 'Model';

    return (
        <div
            className={`absolute bottom-11 right-0 z-50 w-80 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-xl p-2 shadow-2xl ${
                isDark
                    ? 'border border-white/10 bg-[#1a1916] text-zinc-100'
                    : 'border border-neutral-200 bg-white text-neutral-900'
            }`}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div
                    className={
                        isDark
                            ? 'text-sm font-semibold text-zinc-100'
                            : 'text-sm font-semibold text-neutral-950'
                    }
                >
                    模型偏好
                </div>
                <button
                    type="button"
                    onClick={onToggleAutoPreference}
                    className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium transition-colors ${
                        isDark
                            ? 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100'
                            : 'text-neutral-700 hover:text-neutral-950'
                    }`}
                    aria-pressed={autoModelPreference}
                >
                    自动
                    <SwitchIndicator checked={autoModelPreference} theme={isDark ? 'dark' : 'light'} />
                </button>
            </div>

            <div
                className={`mb-2 grid grid-cols-4 rounded-md p-0.5 ${
                    isDark ? 'bg-zinc-800/90' : 'bg-neutral-100'
                }`}
            >
                {MODEL_PREFERENCE_TABS.map((tabItem) => (
                    <button
                        key={tabItem.value}
                        type="button"
                        onClick={() => onTabChange(tabItem.value)}
                        className={`h-7 rounded-sm text-xs font-medium transition-colors ${
                            modelPreferenceTab === tabItem.value
                                ? isDark
                                    ? 'bg-zinc-600 text-zinc-50 shadow-sm'
                                    : 'bg-white text-neutral-950 shadow-sm'
                                : isDark
                                  ? 'text-zinc-400 hover:text-zinc-200'
                                  : 'text-neutral-600 hover:text-neutral-950'
                        }`}
                    >
                        {tabItem.label}
                    </button>
                ))}
            </div>

            {modelCatalogError ? (
                <div
                    className={`mb-2 rounded-md px-2.5 py-1.5 text-xs leading-4 ${
                        isDark
                            ? 'bg-red-950/50 text-red-300'
                            : 'bg-red-50 text-red-600'
                    }`}
                >
                    {modelCatalogError}
                </div>
            ) : null}

            <div
                className={
                    isDark
                        ? 'mb-1.5 text-xs font-medium text-zinc-500'
                        : 'mb-1.5 text-xs font-medium text-neutral-500'
                }
            >
                {title}
            </div>

            <div className="max-h-60 overflow-y-auto pr-0.5">
                {modelPreferenceTab === '3d' ? (
                    <div
                        className={
                            isDark
                                ? 'rounded-lg bg-zinc-800/50 px-3 py-5 text-center text-xs text-zinc-500'
                                : 'rounded-lg bg-neutral-50 px-3 py-5 text-center text-xs text-neutral-500'
                        }
                    >
                        暂无接入 3D 模型
                    </div>
                ) : options.length > 0 ? (
                    options.map((option) => {
                        const selected = isOptionSelected(option);
                        const timeLabel = modelOptionTime(option);
                        return (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => onOptionSelect(option)}
                                className={
                                    isDark
                                        ? 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/5'
                                        : 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 transition-colors hover:bg-neutral-50'
                                }
                            >
                                <span
                                    className={
                                        isDark
                                            ? 'flex h-8 w-8 shrink-0 items-center justify-center text-zinc-300'
                                            : 'flex h-8 w-8 shrink-0 items-center justify-center text-neutral-700'
                                    }
                                >
                                    {getOptionIcon(option, 15)}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span
                                        className={
                                            isDark
                                                ? 'block truncate text-sm font-medium text-zinc-100'
                                                : 'block truncate text-sm font-medium text-neutral-800'
                                        }
                                    >
                                        {option.label}
                                        {option.kind === 'video' && option.label.includes('Seedance') && (
                                            <span
                                                className={
                                                    isDark
                                                        ? 'ml-1.5 rounded bg-blue-500/20 px-1 py-0.5 text-[10px] font-medium text-blue-300'
                                                        : 'ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-600'
                                                }
                                            >
                                                会员专属
                                            </span>
                                        )}
                                    </span>
                                    <span
                                        className={
                                            isDark
                                                ? 'mt-0.5 block line-clamp-2 text-xs leading-4 text-zinc-500'
                                                : 'mt-0.5 block line-clamp-2 text-xs leading-4 text-neutral-500'
                                        }
                                    >
                                        {modelOptionDescription(option)}
                                    </span>
                                    {timeLabel && (
                                        <span
                                            className={
                                                isDark
                                                    ? 'mt-0.5 inline-flex rounded bg-zinc-700/80 px-1 py-0.5 text-[10px] text-zinc-400'
                                                    : 'mt-0.5 inline-flex rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500'
                                            }
                                        >
                                            {timeLabel}
                                        </span>
                                    )}
                                </span>
                                {selected && (
                                    <Check
                                        size={14}
                                        className={
                                            isDark
                                                ? 'h-3.5 w-3.5 shrink-0 text-zinc-100'
                                                : 'h-3.5 w-3.5 shrink-0 text-neutral-800'
                                        }
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        );
                    })
                ) : (
                    <div
                        className={
                            isDark
                                ? 'rounded-lg bg-zinc-800/50 px-3 py-5 text-center text-xs text-zinc-500'
                                : 'rounded-lg bg-neutral-50 px-3 py-5 text-center text-xs text-neutral-500'
                        }
                    >
                        {isLoadingModelCatalog ? '正在加载模型...' : '暂无可用模型'}
                    </div>
                )}
            </div>
        </div>
    );
}
