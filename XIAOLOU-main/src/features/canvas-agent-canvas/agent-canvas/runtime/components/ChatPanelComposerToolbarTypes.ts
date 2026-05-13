import type { ComponentType, ReactNode } from 'react';

import type { VideoComposerMode } from './useChatPanelVideoGeneration';

export type { VideoComposerMode } from './useChatPanelVideoGeneration';

export type ComposerMenu =
    | 'more'
    | 'skills'
    | 'mode'
    | 'model'
    | 'imageAttach'
    | 'imageSettings'
    | 'videoSettings'
    | 'videoShot'
    | 'videoAttach'
    | 'share'
    | null;

export type ComposerMode = 'agent' | 'image' | 'video';

export type ComposerModeOption = {
    value: ComposerMode;
    label: string;
    icon: ComponentType<{ size?: number; className?: string }>;
};

export type ImageSize = {
    w: number;
    h: number;
} | null;

export type ImageResolutionOption = {
    value: string;
    previewSize: string;
};

export type ImageAspectRatioOption = {
    value: string;
    label: string;
    icon: ReactNode;
};

export type VideoModeOption = {
    value: VideoComposerMode;
    label: string;
};

export type VideoAspectRatioOption = {
    value: string;
    label: string;
    icon?: ReactNode;
};
