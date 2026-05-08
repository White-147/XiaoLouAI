import React, { memo, useMemo } from 'react';

interface DurationSliderProps {
    availableDurations: number[];
    value: number;
    onChange: (value: number) => void;
    isDark: boolean;
}

const DurationSliderComponent: React.FC<DurationSliderProps> = ({
    availableDurations,
    value,
    onChange,
    isDark,
}) => {
    const sorted = useMemo(() => [...availableDurations].sort((a, b) => a - b), [availableDurations]);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    const snapToNearest = (val: number) => {
        let closest = sorted[0];
        let minDist = Math.abs(val - closest);
        for (const d of sorted) {
            const dist = Math.abs(val - d);
            if (dist < minDist) {
                minDist = dist;
                closest = d;
            }
        }
        return closest;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = Number(e.target.value);
        const snapped = snapToNearest(raw);
        onChange(snapped);
    };

    const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0;

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className={`text-sm font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    时长
                </label>
                <span className={`text-sm font-medium tabular-nums ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                    {value}秒
                </span>
            </div>
            <div className="py-1">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    onChange={handleChange}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-neutral-900 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:bg-neutral-900 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
                    style={{
                        background: isDark
                            ? `linear-gradient(to right, #e5e5e5 0%, #e5e5e5 ${percentage}%, #404040 ${percentage}%, #404040 100%)`
                            : `linear-gradient(to right, #1a1a1a 0%, #1a1a1a ${percentage}%, #e5e5e5 ${percentage}%, #e5e5e5 100%)`
                    }}
                    onWheel={(e) => e.stopPropagation()}
                />
            </div>
        </div>
    );
};

export const DurationSlider = memo(DurationSliderComponent);
