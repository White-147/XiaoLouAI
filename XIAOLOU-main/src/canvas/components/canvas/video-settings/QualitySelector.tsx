import React, { memo } from 'react';

interface QualitySelectorProps {
    options: string[];
    value: string;
    onChange: (value: string) => void;
    isDark: boolean;
}

const QualitySelectorComponent: React.FC<QualitySelectorProps> = ({
    options,
    value,
    onChange,
    isDark,
}) => {
    const currentVal = value || options[0];

    return (
        <div>
            <label className={`block text-sm font-medium mb-3 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                画质
            </label>
            <div className="flex flex-wrap gap-2">
                {options.map(option => {
                    const isSelected = currentVal.toLowerCase() === option.toLowerCase();
                    return (
                        <button
                            key={option}
                            onClick={() => onChange(option)}
                            className={`px-5 py-2 text-sm font-medium rounded-xl border-[1.5px] transition-all duration-150
                                ${isSelected
                                    ? isDark
                                        ? 'border-white bg-transparent text-white'
                                        : 'border-neutral-900 bg-transparent text-neutral-900'
                                    : isDark
                                        ? 'border-neutral-600 text-neutral-500 hover:border-neutral-500'
                                        : 'border-neutral-200 text-neutral-400 hover:border-neutral-300'
                                }`}
                        >
                            {option}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export const QualitySelector = memo(QualitySelectorComponent);
