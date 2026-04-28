import { useCallback, useEffect, useRef } from 'react';

export function useAutosizeTextarea(
    value: string,
    minHeight: number,
    maxHeight: number,
) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        textarea.style.height = 'auto';
        const nextHeight = Math.min(
            Math.max(textarea.scrollHeight, minHeight),
            maxHeight,
        );
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }, [maxHeight, minHeight]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            resizeTextarea();
            return;
        }

        const frame = window.requestAnimationFrame(resizeTextarea);
        return () => window.cancelAnimationFrame(frame);
    }, [resizeTextarea, value]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleResize = () => resizeTextarea();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [resizeTextarea]);

    return { textareaRef, resizeTextarea };
}
