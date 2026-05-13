import type { AgentCanvasSkill } from '../config/agentCanvasSkills';
import type { VideoComposerMode } from './useChatPanelVideoGeneration';

type ComposerMode = 'agent' | 'image' | 'video';

type VideoModeOption = {
    value: VideoComposerMode;
    label: string;
};

export type BuildChatPanelComposerInstructionParams = {
    skill: AgentCanvasSkill | null;
    composerMode: ComposerMode;
    thinkingModeEnabled: boolean;
    autoModelPreference: boolean;
    selectedImagePoolLabels: string[];
    selectedImageLabel?: string;
    defaultImageLabel: string;
    selectedVideoPoolLabels: string[];
    selectedVideoLabel?: string;
    currentVideoModelId: string;
    selectedVideoTool: string;
    showImageResolutionSettings: boolean;
    currentImageResolution: string;
    currentImageAspectRatioLabel: string;
    showImageDimensionSettings: boolean;
    hasCurrentImageSize: boolean;
    currentImageSizeLabel: string;
    showImageOutputCountSettings: boolean;
    currentImageBatchCount: number;
    videoComposerMode: VideoComposerMode;
    videoModeOptions: VideoModeOption[];
    currentVideoAspectRatio: string;
    showVideoResolution: boolean;
    currentVideoResolution: string;
    showVideoDuration: boolean;
    currentVideoDuration: string;
    supportsVideoAudioOutput: boolean;
    videoGenerateAudio: boolean;
    webSearchEnabled: boolean;
    selectedVideoShot: string;
};

function getImageModelLabel({
    autoModelPreference,
    selectedImagePoolLabels,
    selectedImageLabel,
    defaultImageLabel,
}: Pick<
    BuildChatPanelComposerInstructionParams,
    'autoModelPreference' | 'selectedImagePoolLabels' | 'selectedImageLabel' | 'defaultImageLabel'
>) {
    if (autoModelPreference) {
        return selectedImagePoolLabels.length
            ? selectedImagePoolLabels.join(' / ')
            : selectedImageLabel || defaultImageLabel;
    }
    return selectedImageLabel || defaultImageLabel;
}

function getVideoModelLabel({
    autoModelPreference,
    selectedVideoPoolLabels,
    selectedVideoLabel,
    currentVideoModelId,
    selectedVideoTool,
}: Pick<
    BuildChatPanelComposerInstructionParams,
    | 'autoModelPreference'
    | 'selectedVideoPoolLabels'
    | 'selectedVideoLabel'
    | 'currentVideoModelId'
    | 'selectedVideoTool'
>) {
    const fallback = selectedVideoLabel || currentVideoModelId || selectedVideoTool || 'auto';
    return autoModelPreference && selectedVideoPoolLabels.length
        ? selectedVideoPoolLabels.join(' / ')
        : fallback;
}

function getVideoModeLabel(videoComposerMode: VideoComposerMode, videoModeOptions: VideoModeOption[]) {
    return videoModeOptions.find((mode) => mode.value === videoComposerMode)?.label || videoComposerMode;
}

export function buildChatPanelComposerInstruction({
    skill,
    composerMode,
    thinkingModeEnabled,
    autoModelPreference,
    selectedImagePoolLabels,
    selectedImageLabel,
    defaultImageLabel,
    selectedVideoPoolLabels,
    selectedVideoLabel,
    currentVideoModelId,
    selectedVideoTool,
    showImageResolutionSettings,
    currentImageResolution,
    currentImageAspectRatioLabel,
    showImageDimensionSettings,
    hasCurrentImageSize,
    currentImageSizeLabel,
    showImageOutputCountSettings,
    currentImageBatchCount,
    videoComposerMode,
    videoModeOptions,
    currentVideoAspectRatio,
    showVideoResolution,
    currentVideoResolution,
    showVideoDuration,
    currentVideoDuration,
    supportsVideoAudioOutput,
    videoGenerateAudio,
    webSearchEnabled,
    selectedVideoShot,
}: BuildChatPanelComposerInstructionParams) {
    const imageModelLabel = getImageModelLabel({
        autoModelPreference,
        selectedImagePoolLabels,
        selectedImageLabel,
        defaultImageLabel,
    });
    const videoModelLabel = getVideoModelLabel({
        autoModelPreference,
        selectedVideoPoolLabels,
        selectedVideoLabel,
        currentVideoModelId,
        selectedVideoTool,
    });
    const lines: string[] = [
        '请默认使用简体中文回复，除非用户明确要求其他语言。',
    ];

    if (thinkingModeEnabled) {
        lines.push('启用思考模式：先制定复杂任务计划，再按步骤自主执行；回复中只展示清晰结论和必要步骤，不暴露内部推理。');
    }

    if (skill) {
        lines.push(`当前启用 Skill：${skill.title}（${skill.id}）。`);
        if (skill.hiddenInstruction) {
            lines.push(skill.hiddenInstruction);
        }
    }

    if (composerMode === 'image') {
        lines.push('当前选择图像模式：优先完成图片创作、图片分析、图片生成或图片编辑任务。');
        lines.push([
            '图像生成参数：',
            `模型=${imageModelLabel}`,
            showImageResolutionSettings ? `分辨率=${currentImageResolution || '自动'}` : null,
            `宽高比=${currentImageAspectRatioLabel}`,
            showImageDimensionSettings && hasCurrentImageSize ? `尺寸=${currentImageSizeLabel}` : null,
            showImageOutputCountSettings ? `数量=${currentImageBatchCount}张` : null,
        ].filter(Boolean).join('；'));
    } else if (composerMode === 'video') {
        lines.push('当前选择视频模式：优先完成视频脚本、视频生成、分镜或运镜任务。');
        lines.push([
            '视频生成参数：',
            `模型=${videoModelLabel}`,
            `生成方式=${getVideoModeLabel(videoComposerMode, videoModeOptions)}`,
            `画幅=${currentVideoAspectRatio}`,
            showVideoResolution ? `分辨率=${currentVideoResolution}` : null,
            showVideoDuration ? `时长=${currentVideoDuration}` : null,
            supportsVideoAudioOutput ? `音频=${videoGenerateAudio ? '开启' : '关闭'}` : null,
            webSearchEnabled ? '网络搜索=开启' : null,
            selectedVideoShot ? `基础镜头=${selectedVideoShot}` : null,
        ].filter(Boolean).join('；'));
    } else {
        lines.push('当前选择 Agent 模式：可综合使用 Planner Agent、图片/视频 Creator Agent 和工具调用完成任务。');
    }

    return lines.join('\n');
}
