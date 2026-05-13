import type {
    VideoApiMode,
    VideoComposerMode,
} from './useChatPanelVideoGeneration';

export type ChatPanelVideoModeOption = {
    value: VideoComposerMode;
    label: string;
    apiMode: VideoApiMode;
};

export const VIDEO_MODE_OPTIONS: ChatPanelVideoModeOption[] = [
    { value: 'reference', label: '参考图/视频', apiMode: 'image_to_video' },
    { value: 'start_end_frame', label: '首尾帧', apiMode: 'start_end_frame' },
    { value: 'multi_param', label: '多图参考', apiMode: 'multi_param' },
    { value: 'video_edit', label: '视频编辑', apiMode: 'video_edit' },
    { value: 'motion_control', label: '动作控制', apiMode: 'motion_control' },
];

export const VIDEO_SHOT_OPTIONS = [
    '环绕主体运镜',
    '固定镜头',
    '手持镜头',
    '拉远缩放',
    '推进',
    '跟随拍摄',
    '向右摇摄',
    '向左摇摄',
    '向上摇摄',
    '向下摇摄',
    '环绕拍摄',
];

export const PRIMARY_VIDEO_COMPOSER_MODES: ReadonlySet<VideoComposerMode> = new Set<VideoComposerMode>([
    'reference',
    'start_end_frame',
]);

export const VIDEO_CAPABILITY_API_MODES: VideoApiMode[] = [
    'image_to_video',
    'start_end_frame',
    'multi_param',
    'video_edit',
    'video_extend',
    'motion_control',
];
