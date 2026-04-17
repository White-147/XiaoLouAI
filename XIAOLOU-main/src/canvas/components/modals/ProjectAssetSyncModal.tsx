import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, Video, X } from 'lucide-react';

export type CanvasProjectAssetSyncDraft = {
    id: string;
    mediaKind: 'image' | 'video';
    previewUrl: string | null;
    mediaUrl: string | null;
    prompt: string;
    model: string;
    aspectRatio: string;
    sourceTaskId?: string | null;
    defaultAssetType: string;
    defaultName: string;
    defaultDescription: string;
};

type CanvasProjectAssetSyncPayload = {
    assetType: string;
    name: string;
    description?: string;
    previewUrl?: string | null;
    mediaKind: 'image' | 'video';
    mediaUrl?: string | null;
    sourceTaskId?: string | null;
    generationPrompt?: string;
    imageModel?: string;
    aspectRatio?: string;
    scope: 'manual';
};

interface ProjectAssetSyncModalProps {
    item: CanvasProjectAssetSyncDraft | null;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (payload: CanvasProjectAssetSyncPayload) => Promise<void> | void;
}

const IMAGE_ASSET_TYPES = [
    { value: 'character', label: '角色' },
    { value: 'scene', label: '场景' },
    { value: 'prop', label: '道具' },
    { value: 'style', label: '风格' },
];

const VIDEO_ASSET_TYPES = [{ value: 'video_ref', label: '视频素材' }];

export const ProjectAssetSyncModal: React.FC<ProjectAssetSyncModalProps> = ({
    item,
    submitting,
    onClose,
    onSubmit,
}) => {
    const typeOptions = useMemo(
        () => (item?.mediaKind === 'video' ? VIDEO_ASSET_TYPES : IMAGE_ASSET_TYPES),
        [item?.mediaKind],
    );
    const [assetType, setAssetType] = useState(typeOptions[0]?.value ?? 'style');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (!item) return;
        setAssetType(item.defaultAssetType);
        setName(item.defaultName);
        setDescription(item.defaultDescription);
    }, [item]);

    useEffect(() => {
        if (!typeOptions.some((option) => option.value === assetType)) {
            setAssetType(typeOptions[0]?.value ?? 'style');
        }
    }, [assetType, typeOptions]);

    if (!item) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl rounded-2xl border border-neutral-700 bg-[#111] text-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
                    <div>
                        <h3 className="text-lg font-semibold">同步到项目资产库</h3>
                        <p className="mt-1 text-xs text-neutral-400">
                            先确认标签、名称和说明，再写入当前项目资产库。
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-md p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        {item.mediaKind === 'video' ? (
                            item.mediaUrl ? (
                                <video
                                    src={item.mediaUrl}
                                    poster={item.previewUrl || undefined}
                                    controls
                                    className="min-h-[240px] w-full object-contain"
                                />
                            ) : (
                                <div className="flex min-h-[240px] items-center justify-center text-sm text-neutral-500">
                                    当前视频结果还不可预览
                                </div>
                            )
                        ) : item.previewUrl ? (
                            <img
                                src={item.previewUrl}
                                alt={item.prompt || '画布生成图片'}
                                className="min-h-[240px] w-full object-contain"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="flex min-h-[240px] items-center justify-center text-sm text-neutral-500">
                                当前图片结果还不可预览
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            {item.mediaKind === 'video' ? (
                                <Video className="h-4 w-4 text-primary" />
                            ) : (
                                <ImageIcon className="h-4 w-4 text-primary" />
                            )}
                            {item.mediaKind === 'video' ? '视频素材' : '图片素材'}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">标签</label>
                            <select
                                value={assetType}
                                onChange={(event) => setAssetType(event.target.value)}
                                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            >
                                {typeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">名称</label>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">说明</label>
                            <textarea
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                className="h-32 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="rounded-lg border border-neutral-800 p-3">
                                <div className="text-neutral-500">模型</div>
                                <div className="mt-1 font-medium text-neutral-100">{item.model || '-'}</div>
                            </div>
                            <div className="rounded-lg border border-neutral-800 p-3">
                                <div className="text-neutral-500">比例</div>
                                <div className="mt-1 font-medium text-neutral-100">{item.aspectRatio || '-'}</div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={onClose}
                                className="rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                            >
                                取消
                            </button>
                            <button
                                onClick={() =>
                                    void onSubmit({
                                        assetType,
                                        name: name.trim(),
                                        description: description.trim(),
                                        previewUrl: item.previewUrl,
                                        mediaKind: item.mediaKind,
                                        mediaUrl: item.mediaUrl,
                                        sourceTaskId: item.sourceTaskId ?? null,
                                        generationPrompt: item.prompt,
                                        imageModel: item.model,
                                        aspectRatio: item.aspectRatio,
                                        scope: 'manual',
                                    })
                                }
                                disabled={submitting || !name.trim()}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                确认同步
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
