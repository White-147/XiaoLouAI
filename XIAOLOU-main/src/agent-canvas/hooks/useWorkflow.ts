/**
 * useWorkflow.ts
 * 
 * Custom hook for managing workflow save/load functionality.
 * Handles persistence to the backend server.
 */

import React, { useState, useCallback, Dispatch, SetStateAction } from 'react';
import { NodeData, NodeGroup, NodeStatus, NodeType, Viewport } from '../types';
import { buildXiaolouRequestHeaders } from '../integrations/xiaolouCanvasSession';
import { hasCanvasHostServices, getCanvasHostServices } from '../integrations/canvasHostServices';
import { buildCanvasApiUrl } from '../integrations/twitcanvaRuntimePaths';
import { canUseXiaolouWorkflowBridge, loadXiaolouCanvasProject } from '../integrations/xiaolouWorkflowBridge';
import {
    defaultCanvasUploadDeps,
    sanitizeCanvasGroupsForPersistence,
    sanitizeCanvasNodesForCloudSave,
    sanitizeCanvasNodesForPersistence,
} from '../utils/canvasPersistence';

interface WorkflowData {
    id: string | null;
    title: string;
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    agentContext?: unknown | null;
}

interface UseWorkflowOptions {
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    canvasTitle: string;
    setNodes: Dispatch<SetStateAction<NodeData[]>>;
    setGroups: Dispatch<SetStateAction<NodeGroup[]>>; // For restoring groups when loading
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setCanvasTitle: (title: string) => void;
    setEditingTitleValue: (value: string) => void;
    getAgentContext?: () => unknown | null;
    onPanelOpen?: () => void; // Called when workflow panel opens
}

export const useWorkflow = ({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    getAgentContext,
    onPanelOpen
}: UseWorkflowOptions) => {
    // Workflow state
    const [workflowId, setWorkflowId] = useState<string | null>(null);
    const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);

    /**
     * Save current workflow to server
     */
    const handleSaveWorkflow = useCallback(async () => {
        const sanitizedNodes = sanitizeCanvasNodesForPersistence(nodes);
        try {
            const workflow: WorkflowData = {
                id: workflowId,
                title: canvasTitle,
                nodes: sanitizedNodes,
                groups,
                viewport,
                agentContext: getAgentContext?.() ?? null,
            };

            try {
                const response = await fetch(buildCanvasApiUrl('/workflows'), {
                    method: 'POST',
                    headers: buildXiaolouRequestHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(workflow)
                });

                if (response.ok) {
                    const result = await response.json();
                    setWorkflowId(result.id);
                    console.log('Workflow saved:', result.id);
                }
            } catch (localError) {
                console.warn('Canvas local save failed (non-fatal):', localError);
            }
        } finally {
            const imageUrls = sanitizedNodes
                .filter(n =>
                    (n.type === NodeType.IMAGE || n.type === NodeType.IMAGE_EDITOR) &&
                    n.status === NodeStatus.SUCCESS &&
                    n.resultUrl &&
                    !n.resultUrl.startsWith('data:')
                )
                .map(n => n.resultUrl!)
                .slice(0, 4);

            const workflowSnapshot = {
                id: workflowId,
                title: canvasTitle,
                nodes: sanitizedNodes,
                groups,
                viewport,
                agentContext: getAgentContext?.() ?? null,
            };

            // Direct-embed mode: call host services save directly
            if (hasCanvasHostServices()) {
                const services = getCanvasHostServices();
                await services?.saveCanvas(workflowSnapshot, imageUrls);
            }

            // iframe mode: notify parent via postMessage
            if (typeof window !== 'undefined' && window.parent !== window) {
                window.parent.postMessage({
                    channel: 'xiaolou.canvasSaveBridge',
                    direction: 'notify',
                    workflow: workflowSnapshot,
                    thumbnailImageUrls: imageUrls,
                }, '*');
            }
        }
    }, [workflowId, canvasTitle, nodes, groups, viewport, getAgentContext]);

    /**
     * Load workflow from server
     * Supports both user workflows and public workflows (prefixed with "public:")
     * Returns the loaded workflow's node count and title for tracking
     */
    const handleLoadWorkflow = useCallback(async (id: string): Promise<{ nodeCount: number; title: string } | null> => {
        try {
            const isCloud = id.startsWith('cloud:');
            const isPublic = id.startsWith('public:');

            if (isCloud && canUseXiaolouWorkflowBridge()) {
                const cloudId = id.replace('cloud:', '');
                const project = await loadXiaolouCanvasProject(cloudId);
                const canvasData = project.canvasData;

                setWorkflowId(null);
                setCanvasTitle(project.title || '未命名');
                setEditingTitleValue(project.title || '未命名');
                setNodes(Array.isArray(canvasData?.nodes) ? sanitizeCanvasNodesForPersistence(canvasData.nodes as NodeData[]) : []);
                setGroups(Array.isArray(canvasData?.groups) ? canvasData.groups as NodeGroup[] : []);
                setSelectedNodeIds([]);
                setIsWorkflowPanelOpen(false);
                console.log('Cloud project loaded:', cloudId);

                return {
                    nodeCount: Array.isArray(canvasData?.nodes) ? canvasData.nodes.length : 0,
                    title: project.title || '未命名',
                };
            }

            const actualId = isPublic ? id.replace('public:', '') : id;
            const endpoint = isPublic
                ? buildCanvasApiUrl(`/public-workflows/${actualId}`)
                : buildCanvasApiUrl(`/workflows/${actualId}`);

            const response = await fetch(endpoint, {
                headers: buildXiaolouRequestHeaders()
            });
            if (response.ok) {
                const workflow = await response.json();

                if (!isPublic) {
                    setWorkflowId(workflow.id);
                } else {
                    setWorkflowId(null);
                }

                setCanvasTitle(workflow.title || '未命名');
                setEditingTitleValue(workflow.title || '未命名');
                setNodes(Array.isArray(workflow.nodes) ? sanitizeCanvasNodesForPersistence(workflow.nodes as NodeData[]) : []);
                setGroups(workflow.groups || []);
                setSelectedNodeIds([]);
                setIsWorkflowPanelOpen(false);
                console.log(isPublic ? 'Public workflow loaded:' : 'Workflow loaded:', actualId);
                return {
                    nodeCount: (workflow.nodes || []).length,
                    title: workflow.title || '未命名'
                };
            }
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
        return null;
    }, [setNodes, setGroups, setSelectedNodeIds, setCanvasTitle, setEditingTitleValue]);

    /**
     * Handle workflow panel toggle from toolbar click
     */
    const handleWorkflowsClick = useCallback((_e: React.MouseEvent) => {
        setIsWorkflowPanelOpen(prev => !prev);
        onPanelOpen?.(); // Close other panels
    }, [onPanelOpen]);

    /**
     * Close workflow panel
     */
    const closeWorkflowPanel = useCallback(() => {
        setIsWorkflowPanelOpen(false);
    }, []);

    /**
     * Reset workflow ID (for creating a new canvas)
     */
    const resetWorkflowId = useCallback(() => {
        setWorkflowId(null);
    }, []);

    const hydrateWorkflowId = useCallback((nextWorkflowId: string | null) => {
        setWorkflowId(nextWorkflowId);
    }, []);

    return {
        workflowId,
        isWorkflowPanelOpen,
        handleSaveWorkflow,
        handleLoadWorkflow,
        handleWorkflowsClick,
        closeWorkflowPanel,
        resetWorkflowId,
        hydrateWorkflowId
    };
};
