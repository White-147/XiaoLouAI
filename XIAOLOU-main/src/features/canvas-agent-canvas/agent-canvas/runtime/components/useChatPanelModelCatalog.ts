import { useEffect, useMemo, useState } from 'react';

import {
    fetchNativeAgentModelsAndTools,
    type NativeAgentModelInfo,
    type NativeAgentToolInfo,
} from '../services/nativeAgentCatalog';
import {
    COT_TEXT_MODEL_IDS,
    PREFERRED_IMAGE_TOOL_IDS,
    PREFERRED_TEXT_MODEL_IDS,
    PREFERRED_VIDEO_TOOL_IDS,
    areModelPoolsEqual,
    normalizeSelectedModelPool,
    pickPreferredModel,
    toTextModelOptions,
    toToolModelOptions,
    type ComposerModelOption,
} from './chatPanelModelOptions';

export function useChatPanelModelCatalog() {
    const [agentModels, setAgentModels] = useState<NativeAgentModelInfo[]>([]);
    const [agentTools, setAgentTools] = useState<NativeAgentToolInfo[]>([]);
    const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(false);
    const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
    const [selectedTextModel, setSelectedTextModel] = useState('');
    const [selectedImageTool, setSelectedImageTool] = useState('');
    const [selectedVideoTool, setSelectedVideoTool] = useState('');
    const [selectedImageToolIds, setSelectedImageToolIds] = useState<string[]>([]);
    const [selectedVideoToolIds, setSelectedVideoToolIds] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;

        const loadCatalog = async () => {
            setIsLoadingModelCatalog(true);
            setModelCatalogError(null);
            try {
                const catalog = await fetchNativeAgentModelsAndTools();
                if (cancelled) return;
                setAgentModels(catalog.models);
                setAgentTools(catalog.tools);
            } catch (err) {
                if (cancelled) return;
                setModelCatalogError(err instanceof Error ? err.message : '模型列表加载失败');
            } finally {
                if (!cancelled) {
                    setIsLoadingModelCatalog(false);
                }
            }
        };

        void loadCatalog();

        return () => {
            cancelled = true;
        };
    }, []);

    const textModelOptions = useMemo(() => toTextModelOptions(agentModels), [agentModels]);
    const cotTextModelOptions = useMemo(
        () => COT_TEXT_MODEL_IDS
            .map((id) => textModelOptions.find((option) => option.id === id))
            .filter((option): option is ComposerModelOption => Boolean(option)),
        [textModelOptions],
    );
    const imageModelOptions = useMemo(() => toToolModelOptions(agentTools, 'image'), [agentTools]);
    const videoModelOptions = useMemo(() => toToolModelOptions(agentTools, 'video'), [agentTools]);

    useEffect(() => {
        if (!selectedTextModel && textModelOptions.length > 0) {
            setSelectedTextModel(pickPreferredModel(textModelOptions, PREFERRED_TEXT_MODEL_IDS));
        }
    }, [selectedTextModel, textModelOptions]);

    useEffect(() => {
        if (!imageModelOptions.length) {
            setSelectedImageTool('');
            setSelectedImageToolIds([]);
            return;
        }

        const nextPool = normalizeSelectedModelPool(
            selectedImageToolIds,
            imageModelOptions,
            PREFERRED_IMAGE_TOOL_IDS,
        );
        if (!areModelPoolsEqual(selectedImageToolIds, nextPool)) {
            setSelectedImageToolIds(nextPool);
        }
        if (!nextPool.includes(selectedImageTool)) {
            setSelectedImageTool(nextPool[0] || '');
        }
    }, [selectedImageTool, selectedImageToolIds, imageModelOptions]);

    useEffect(() => {
        if (!videoModelOptions.length) {
            setSelectedVideoTool('');
            setSelectedVideoToolIds([]);
            return;
        }

        const nextPool = normalizeSelectedModelPool(
            selectedVideoToolIds,
            videoModelOptions,
            PREFERRED_VIDEO_TOOL_IDS,
        );
        if (!areModelPoolsEqual(selectedVideoToolIds, nextPool)) {
            setSelectedVideoToolIds(nextPool);
        }
        if (!nextPool.includes(selectedVideoTool)) {
            setSelectedVideoTool(nextPool[0] || '');
        }
    }, [selectedVideoTool, selectedVideoToolIds, videoModelOptions]);

    return {
        isLoadingModelCatalog,
        modelCatalogError,
        textModelOptions,
        cotTextModelOptions,
        imageModelOptions,
        videoModelOptions,
        selectedTextModel,
        selectedImageTool,
        selectedVideoTool,
        selectedImageToolIds,
        selectedVideoToolIds,
        setSelectedTextModel,
        setSelectedImageTool,
        setSelectedVideoTool,
        setSelectedImageToolIds,
        setSelectedVideoToolIds,
    };
}
