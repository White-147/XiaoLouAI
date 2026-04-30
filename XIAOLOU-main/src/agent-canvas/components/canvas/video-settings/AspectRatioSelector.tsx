import React, { memo } from 'react';

interface AspectRatioSelectorProps {
    options: string[];
    value: string;
    onChange: (value: string) => void;
    isDark: boolean;
}

const RATIO_SHAPES: Record<string, { w: number; h: number }> = {
    '16:9': { w: 20, h: 12 },
    '4:3': { w: 16, h: 12 },
    '1:1': { w: 14, h: 14 },
    '3:4': { w: 12, h: 16 },
    '9:16': { w: 10, h: 18 },
    '21:9': { w: 24, h: 10 },
    '3:2': { w: 18, h: 12 },
    '2:3': { w: 12, h: 18 },
    'adaptive': { w: 16, h: 14 },
};

const RATIO_LABELS: Record<string, string> = {
    'adaptive': '自适应',
    'Auto': '自动',
};

function RatioIcon({ ratio, selected }: { ratio: string; selected: boolean }) {
    const shape = RATIO_SHAPES[ratio];
    if (!shape) return null;

    return (
        <div
            className={`rounded-[3px] transition-colors ${
                selected ? 'border-[1.5px] border-white' : 'border-[1.5px] border-neutral-400'
            }`}
            style={{ width: shape.w, height: shape.h }}
        />
    );
}

const AspectRatioSelectorComponent: React.FC<AspectRatioSelectorProps> = ({
    options,
    value,
    onChange,
    isDark,
}) => {
    return (
        <div>
            <label className={`block text-sm font-medium mb-3 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                画幅比例
            </label>
            <div className="grid grid-cols-4 gap-2">
                {options.map(option => {
                    const isSelected = value === option;
                    const hasShape = RATIO_SHAPES[option];
                    return (
                        <button
                            key={option}
                            onClick={() => onChange(option)}
                            className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border-[1.5px] text-xs font-medium transition-all duration-150
                                ${isSelected
                                    ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm'
                                    : isDark
                                        ? 'border-neutral-600 bg-transparent text-neutral-400 hover:border-neutral-500'
                                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                                }`}
                        >
                            {hasShape && <RatioIcon ratio={option} selected={isSelected} />}
                            <span>{RATIO_LABELS[option] || option}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export const AspectRatioSelector = memo(AspectRatioSelectorComponent);
