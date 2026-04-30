/**
 * WorkflowPanel.tsx
 * 
 * Panel for browsing and managing saved workflows.
 * Shows list of workflows with options to load, delete, or edit cover.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2, FileText, Loader2, Pencil, Check, Cloud } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { buildXiaolouRequestHeaders } from '../integrations/xiaolouCanvasSession';
import { buildCanvasApiUrl, resolveCanvasMediaUrl } from '../integrations/twitcanvaRuntimePaths';
import {
    canUseXiaolouWorkflowBridge,
    listXiaolouCanvasProjects,
    deleteXiaolouCanvasProject,
    type CanvasProjectSummary,
} from '../integrations/xiaolouWorkflowBridge';

interface WorkflowSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodeCount: number;
    coverUrl?: string;
    description?: string; // For public workflows
}

interface AssetMetadata {
    id: string;
    url: string;
    prompt?: string;
    createdAt: string;
}

interface WorkflowPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadWorkflow: (workflowId: string) => void;
    currentWorkflowId?: string;
    canvasTheme?: 'dark' | 'light';
}

export const WorkflowPanel: React.FC<WorkflowPanelProps> = ({
    isOpen,
    onClose,
    onLoadWorkflow,
    currentWorkflowId,
    canvasTheme = 'dark'
}) => {
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [publicWorkflows, setPublicWorkflows] = useState<WorkflowSummary[]>([]);
    const [syncedProjects, setSyncedProjects] = useState<CanvasProjectSummary[]>([]);
    const [activeTab, setActiveTab] = useState<'my' | 'synced' | 'public'>('my');
    const [loading, setLoading] = useState(false);
    const [syncedLoading, setSyncedLoading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deleteSyncedConfirm, setDeleteSyncedConfirm] = useState<string | null>(null);
    const hasBridge = canUseXiaolouWorkflowBridge();

    // Cover editing state
    const [editingCoverFor, setEditingCoverFor] = useState<string | null>(null);
    const [coverAssets, setCoverAssets] = useState<AssetMetadata[]>([]);
    const [loadingAssets, setLoadingAssets] = useState(false);

    // Pagination state for cover image modal
    const COVERS_PER_PAGE = 9;
    const [visibleCoverCount, setVisibleCoverCount] = useState(COVERS_PER_PAGE);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Theme helper
    const isDark = canvasTheme === 'dark';

    const fetchSyncedProjects = useCallback(async () => {
        if (!hasBridge) return;
        setSyncedLoading(true);
        try {
            const result = await listXiaolouCanvasProjects();
            setSyncedProjects(result.items || []);
        } catch (error) {
            console.error('Failed to fetch synced projects:', error);
        } finally {
            setSyncedLoading(false);
        }
    }, [hasBridge]);

    const handleDeleteSynced = async (projectId: string) => {
        try {
            await deleteXiaolouCanvasProject(projectId);
            setSyncedProjects(prev => prev.filter(p => p.id !== projectId));
        } catch (error) {
            console.error('Failed to delete synced project:', error);
        }
        setDeleteSyncedConfirm(null);
    };

    useEffect(() => {
        if (isOpen) {
            fetchWorkflows();
            fetchPublicWorkflows();
            fetchSyncedProjects();
        }
    }, [isOpen, fetchSyncedProjects]);

    const fetchWorkflows = async () => {
        setLoading(true);
        try {
            const response = await fetch(buildCanvasApiUrl('/workflows'), {
                headers: buildXiaolouRequestHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                setWorkflows(data);
            }
        } catch (error) {
            console.error('Failed to fetch workflows:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchPublicWorkflows = async () => {
        try {
            const response = await fetch(buildCanvasApiUrl('/public-workflows'));
            if (response.ok) {
                const data = await response.json();
                setPublicWorkflows(data);
            }
        } catch (error) {
            console.error('Failed to fetch public workflows:', error);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(buildCanvasApiUrl(`/workflows/${id}`), {
                method: 'DELETE',
                headers: buildXiaolouRequestHeaders()
            });
            if (response.ok) {
                setWorkflows(prev => prev.filter(w => w.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete workflow:', error);
        }
        setDeleteConfirm(null);
    };

    // Load more covers callback for infinite scroll
    const loadMoreCovers = useCallback(() => {
        setVisibleCoverCount(prev => Math.min(prev + COVERS_PER_PAGE, coverAssets.length));
    }, [coverAssets.length]);

    // Intersection Observer effect for infinite scroll
    useEffect(() => {
        if (!editingCoverFor || loadingAssets) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && visibleCoverCount < coverAssets.length) {
                    loadMoreCovers();
                }
            },
            { threshold: 0.1, rootMargin: '100px' }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [editingCoverFor, loadingAssets, visibleCoverCount, coverAssets.length, loadMoreCovers]);

    const openCoverEditor = async (workflowId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingCoverFor(workflowId);
        setLoadingAssets(true);
        setVisibleCoverCount(COVERS_PER_PAGE); // Reset pagination

        try {
            const response = await fetch(buildCanvasApiUrl('/assets/images'));
            if (response.ok) {
                const data = await response.json();
                setCoverAssets(data);
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoadingAssets(false);
        }
    };

    const selectCover = async (assetUrl: string) => {
        if (!editingCoverFor) return;

        try {
            const response = await fetch(buildCanvasApiUrl(`/workflows/${editingCoverFor}/cover`), {
                method: 'PUT',
                headers: buildXiaolouRequestHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ coverUrl: assetUrl })
            });

            if (response.ok) {
                // Update local state
                setWorkflows(prev => prev.map(w =>
                    w.id === editingCoverFor
                        ? { ...w, coverUrl: assetUrl }
                        : w
                ));
            }
        } catch (error) {
            console.error('Failed to update cover:', error);
        }

        setEditingCoverFor(null);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric'
        });
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Main Panel */}
            <div
                className={`fixed backdrop-blur-xl border rounded-2xl shadow-2xl z-[55] flex flex-col overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a]/95 border-neutral-800' : 'bg-white/95 border-neutral-200'}`}
                style={{
                    bottom: '5.5rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(700px, calc(100vw - 2rem))',
                    maxHeight: 'min(500px, calc(100vh - 7rem))'
                }}
            >
                {/* Header with Tabs */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => setActiveTab('my')}
                            className={`font-medium pb-1 transition-colors ${activeTab === 'my' ? isDark ? 'text-white border-b-2 border-white' : 'text-neutral-900 border-b-2 border-neutral-900' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'}`}
                        >
                            本地项目
                        </button>
                        {hasBridge && (
                            <button
                                onClick={() => setActiveTab('synced')}
                                className={`font-medium pb-1 transition-colors flex items-center gap-1.5 ${activeTab === 'synced' ? isDark ? 'text-white border-b-2 border-white' : 'text-neutral-900 border-b-2 border-neutral-900' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'}`}
                            >
                                <Cloud size={14} />
                                云端项目 ({syncedProjects.length})
                            </button>
                        )}
                        <button
                            onClick={() => setActiveTab('public')}
                            className={`font-medium pb-1 transition-colors ${activeTab === 'public' ? isDark ? 'text-white border-b-2 border-white' : 'text-neutral-900 border-b-2 border-neutral-900' : isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600'}`}
                        >
                            公共模板
                        </button>
                    </div>
                    <button
                        type="button"
                        aria-label="关闭工作流面板"
                        onClick={onClose}
                        className={`rounded-lg p-2 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div
                    className="flex-1 overflow-y-auto p-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading && activeTab === 'my' ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : activeTab === 'my' ? (
                        /* My Workflows Tab */
                        workflows.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-neutral-500">
                                暂无本地项目
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-4">
                                {workflows.map(workflow => (
                                    <div
                                        key={workflow.id}
                                        onClick={() => onLoadWorkflow(workflow.id)}
                                        className={`rounded-xl overflow-hidden cursor-pointer transition-all group ${workflow.id === currentWorkflowId
                                            ? 'ring-2 ring-blue-500'
                                            : ''
                                            }`}
                                    >
                                        {/* Thumbnail */}
                                        <div className="aspect-[4/3] bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center relative overflow-hidden">
                                            {workflow.coverUrl ? (
                                                <img
                                                    src={resolveCanvasMediaUrl(workflow.coverUrl)}
                                                    alt={workflow.title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center">
                                                    <FileText size={28} className="text-neutral-500" />
                                                </div>
                                            )}

                                            {/* Action buttons */}
                                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                {/* Edit cover button */}
                                                <button
                                                    onClick={(e) => openCoverEditor(workflow.id, e)}
                                                    className="p-1.5 bg-black/50 hover:bg-blue-500 rounded-lg transition-all"
                                                    title="编辑封面"
                                                >
                                                    <Pencil size={14} className="text-white" />
                                                </button>
                                                {/* Delete button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(workflow.id);
                                                    }}
                                                    className="p-1.5 bg-black/50 hover:bg-red-500 rounded-lg transition-all"
                                                    title="删除项目"
                                                >
                                                    <Trash2 size={14} className="text-white" />
                                                </button>
                                            </div>
                                        </div>
                                        {/* Info */}
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-neutral-100/90'}`}>
                                            <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}>{workflow.title || '未命名'}</h3>
                                            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-neutral-600'}`}>
                                                {workflow.nodeCount} 个节点
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : activeTab === 'synced' ? (
                        /* Synced Cloud Projects Tab */
                        syncedLoading ? (
                            <div className="flex items-center justify-center h-40">
                                <Loader2 className="animate-spin text-neutral-500" size={24} />
                            </div>
                        ) : syncedProjects.length === 0 ? (
                            <div className={`flex flex-col items-center justify-center h-40 gap-2 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                <Cloud size={32} className="opacity-50" />
                                <p>暂无云端项目</p>
                                <p className="text-xs">点击 SAVE 后项目会自动同步到云端，支持跨设备访问</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-4">
                                {syncedProjects.map(project => (
                                    <div
                                        key={project.id}
                                        onClick={() => onLoadWorkflow(`cloud:${project.id}`)}
                                        className="rounded-xl overflow-hidden cursor-pointer transition-all group"
                                    >
                                        <div className="aspect-[4/3] bg-gradient-to-br from-sky-800/30 to-blue-900/30 flex items-center justify-center relative overflow-hidden">
                                            {project.thumbnailUrl ? (
                                                <img
                                                    src={project.thumbnailUrl}
                                                    alt={project.title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-sky-500/20 to-blue-600/20 flex items-center justify-center">
                                                    <Cloud size={28} className="text-neutral-500" />
                                                </div>
                                            )}
                                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-sky-600/80 rounded text-[10px] font-medium text-white flex items-center gap-1">
                                                <Cloud size={10} />
                                                云端同步
                                            </div>
                                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteSyncedConfirm(project.id);
                                                    }}
                                                    className="p-1.5 bg-black/50 hover:bg-red-500 rounded-lg transition-all"
                                                    title="删除云端项目"
                                                >
                                                    <Trash2 size={14} className="text-white" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-neutral-100/90'}`}>
                                            <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}>{project.title || '未命名'}</h3>
                                            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-neutral-600'}`}>
                                                {new Date(project.updatedAt).toLocaleString('zh-CN')}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        /* Public Workflows Tab */
                        publicWorkflows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-neutral-500 gap-2">
                                <FileText size={32} className="opacity-50" />
                                <p>暂无公共模板</p>
                                <p className="text-xs text-neutral-600">可将工作流 JSON 文件添加到 public/workflows/</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-4">
                                {publicWorkflows.map(workflow => (
                                    <div
                                        key={workflow.id}
                                        onClick={() => onLoadWorkflow(`public:${workflow.id}`)}
                                        className="rounded-xl overflow-hidden cursor-pointer transition-all group"
                                    >
                                        {/* Thumbnail */}
                                        <div className="aspect-[4/3] bg-gradient-to-br from-green-800/30 to-emerald-900/30 flex items-center justify-center relative overflow-hidden">
                                            {workflow.coverUrl ? (
                                                <img
                                                    src={resolveCanvasMediaUrl(workflow.coverUrl)}
                                                    alt={workflow.title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center">
                                                    <FileText size={28} className="text-neutral-500" />
                                                </div>
                                            )}
                                            {/* Public badge */}
                                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-600/80 rounded text-[10px] font-medium text-white">
                                                公共
                                            </div>
                                        </div>
                                        {/* Info */}
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-neutral-100/90'}`}>
                                            <h3 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}>{workflow.title || '未命名'}</h3>
                                            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-neutral-600'}`}>
                                                {workflow.description || `${workflow.nodeCount} 个节点`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[340px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-2">删除本地项目</h3>
                        <p className="text-neutral-400 text-sm mb-6">
                            确定要删除这个本地项目吗？此操作无法撤销。
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Synced Project Confirmation Modal */}
            {deleteSyncedConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className={`border rounded-2xl p-6 w-[340px] shadow-2xl ${isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-neutral-200'}`}>
                        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>删除云端项目</h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            确定要删除这个云端项目吗？删除后所有设备将无法访问。
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteSyncedConfirm(null)}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900'}`}
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDeleteSynced(deleteSyncedConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cover Selection Modal */}
            {editingCoverFor && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[500px] max-h-[500px] shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white">选择封面图片</h3>
                            <button
                                onClick={() => setEditingCoverFor(null)}
                                className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {loadingAssets ? (
                            <div className="flex items-center justify-center h-40">
                                <Loader2 className="animate-spin text-neutral-500" size={24} />
                            </div>
                        ) : coverAssets.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-neutral-500">
                                暂无图片，请先生成一些图片
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-3 overflow-y-auto flex-1">
                                {coverAssets.slice(0, visibleCoverCount).map(asset => (
                                    <button
                                        key={asset.id}
                                        onClick={() => selectCover(asset.url)}
                                        className="h-32 w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all relative group bg-neutral-900"
                                    >
                                        <LazyImage
                                            src={resolveCanvasMediaUrl(asset.url)}
                                            alt="封面选项"
                                            className="w-full h-full"
                                            placeholderClassName="rounded-lg"
                                            rootMargin="100px"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                            <Check size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </button>
                                ))}

                                {/* Load more sentinel - triggers infinite scroll */}
                                {visibleCoverCount < coverAssets.length && (
                                    <div
                                        ref={loadMoreRef}
                                        className="col-span-3 flex items-center justify-center py-4"
                                    >
                                        <Loader2 className="animate-spin text-neutral-500" size={20} />
                                        <span className="ml-2 text-neutral-500 text-sm">加载更多...</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};
