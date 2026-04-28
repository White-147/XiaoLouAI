/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, ContextMenuState } from '../types';
import type { CanvasTool } from '../components/CanvasToolbar';

interface UseKeyboardShortcutsOptions {
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: (setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>) => void;
    clearSelection: () => void;
    clearSelectionBox: () => void;
    undo: () => void;
    redo: () => void;
    onToolChange?: (tool: CanvasTool) => void;
    onQuickAddText?: () => void;
    onQuickAddImage?: () => void;
}

const EDITABLE_SHORTCUT_SELECTOR = 'input, textarea, select, [role="textbox"]';

function isEditableShortcutTarget(target: EventTarget | Element | null): boolean {
    const targetElement = target instanceof Element ? target : null;
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    const candidates = [targetElement, activeElement].filter((element): element is Element => Boolean(element));

    return candidates.some((element) => {
        if (element.closest(EDITABLE_SHORTCUT_SELECTOR)) return true;

        const contentEditableElement = element.closest('[contenteditable]');
        return contentEditableElement instanceof HTMLElement && contentEditableElement.isContentEditable;
    });
}

export const useKeyboardShortcuts = ({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    onToolChange,
    onQuickAddText,
    onQuickAddImage
}: UseKeyboardShortcutsOptions) => {
    const clipboardRef = useRef<NodeData[]>([]);

    // ============================================================================
    // COPY / PASTE / DUPLICATE
    // ============================================================================

    const handleCopy = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
            clipboardRef.current = JSON.parse(JSON.stringify(selectedNodes));
            console.log(`Copied ${selectedNodes.length} node(s)`);
        }
    }, [nodes, selectedNodeIds]);

    const handlePaste = useCallback(() => {
        if (clipboardRef.current.length > 0) {
            const pasteOffset = 50;
            const newNodes: NodeData[] = clipboardRef.current.map(node => ({
                ...node,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                x: node.x + pasteOffset,
                y: node.y + pasteOffset,
                parentIds: undefined,
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
            console.log(`Pasted ${newNodes.length} node(s)`);
        }
    }, [setNodes, setSelectedNodeIds]);

    const handleDuplicate = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
            const nodesToDuplicate = JSON.parse(JSON.stringify(selectedNodes));

            const offset = 20;
            const newNodes: NodeData[] = nodesToDuplicate.map((node: NodeData) => ({
                ...node,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                x: node.x + offset,
                y: node.y + offset,
                parentIds: undefined,
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
        }
    }, [nodes, selectedNodeIds, setNodes, setSelectedNodeIds]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT
    // ============================================================================

    const spaceToolRef = useRef<CanvasTool | null>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditableShortcutTarget(e.target)) return;

            if (e.code === 'Space' && !e.repeat && !spaceToolRef.current) {
                e.preventDefault();
                spaceToolRef.current = 'select';
                onToolChange?.('hand');
                return;
            }

            // Undo: Ctrl+Z (without Shift)
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            // Redo: Ctrl+Y or Ctrl+Shift+Z
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                redo();
                return;
            }

            // Copy: Ctrl+C
            if (e.ctrlKey && e.key === 'c') {
                handleCopy();
                return;
            }

            // Paste: Ctrl+V
            if (e.ctrlKey && e.key === 'v') {
                handlePaste();
                return;
            }

            // Tool shortcuts (no modifier keys)
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'v' || e.key === 'V') {
                    onToolChange?.('select');
                    return;
                }
                if (e.key === 'h' || e.key === 'H') {
                    onToolChange?.('hand');
                    return;
                }
                if (e.key === 't' || e.key === 'T') {
                    onQuickAddText?.();
                    return;
                }
                if (e.key === 'i' || e.key === 'I') {
                    onQuickAddImage?.();
                    return;
                }
            }

            // Delete selected nodes or connection. Backspace is reserved for text editing.
            if (e.key === 'Delete') {
                if (selectedNodeIds.length > 0) {
                    deleteNodes(selectedNodeIds);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                } else if (selectedConnection) {
                    deleteSelectedConnection(setNodes);
                }
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space' && spaceToolRef.current) {
                onToolChange?.(spaceToolRef.current);
                spaceToolRef.current = null;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [
        selectedNodeIds,
        selectedConnection,
        deleteNodes,
        deleteSelectedConnection,
        clearSelection,
        clearSelectionBox,
        undo,
        redo,
        handlePaste,
        handleCopy,
        setNodes,
        setContextMenu,
        onToolChange,
        onQuickAddText,
        onQuickAddImage
    ]);

    return {
        handleCopy,
        handlePaste,
        handleDuplicate
    };
};
