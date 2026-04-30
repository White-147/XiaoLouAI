/**
 * useAutoSave.ts
 *
 * Background-save helper for the canvas.
 * Uses a short idle debounce for normal edits and keeps the periodic timer
 * as a fallback so saves stay invisible to the user.
 */

import { useEffect, useRef } from 'react';
import { NodeData } from '../types';

interface UseAutoSaveOptions {
    isDirty: boolean;
    nodes: NodeData[];
    onSave: () => Promise<void>;
    interval?: number;
    debounceMs?: number;
}

export const useAutoSave = ({
    isDirty,
    nodes,
    onSave,
    interval = 60000,
    debounceMs = 2000
}: UseAutoSaveOptions) => {
    const lastSaveTimeRef = useRef<number>(Date.now());
    const isSavingRef = useRef<boolean>(false);

    useEffect(() => {
        const canRunInForeground = () =>
            typeof document === 'undefined' || document.visibilityState === 'visible';

        const performSave = async (force = false) => {
            if (!force && !canRunInForeground()) return;
            if (!isDirty || nodes.length === 0) return;
            if (isSavingRef.current) return;

            try {
                isSavingRef.current = true;
                await onSave();
                lastSaveTimeRef.current = Date.now();
            } catch (error) {
                console.error('[Auto-Save] Failed to auto-save:', error);
            } finally {
                isSavingRef.current = false;
            }
        };

        const intervalTimer = window.setInterval(() => {
            void performSave(false);
        }, interval);

        const debounceTimer = window.setTimeout(() => {
            void performSave(false);
        }, debounceMs);

        const handleVisibilityChange = () => {
            if (typeof document === 'undefined') return;
            if (document.visibilityState === 'hidden') {
                void performSave(true);
            }
        };

        const handlePageHide = () => {
            void performSave(true);
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', handlePageHide);
        }

        return () => {
            window.clearInterval(intervalTimer);
            window.clearTimeout(debounceTimer);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('pagehide', handlePageHide);
            }
        };
    }, [debounceMs, interval, isDirty, nodes, onSave]);

    return {
        lastSaveTime: lastSaveTimeRef.current
    };
};
