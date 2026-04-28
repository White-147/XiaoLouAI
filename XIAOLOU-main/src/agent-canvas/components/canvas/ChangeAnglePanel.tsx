import React, { useCallback, useMemo } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { getRuntimeConfig } from '../../runtimeConfig';
import { isEndpointConfigured } from '../../services/cameraAngleService';
import {
    ANGLE_ROTATION_MIN,
    ANGLE_ROTATION_MAX,
    ANGLE_TILT_MIN,
    ANGLE_TILT_MAX,
    OrbitCameraControl,
} from './OrbitCameraControl';

interface AngleSettings {
    mode?: 'subject' | 'camera';
    rotation: number;
    tilt: number;
    scale: number;
    wideAngle: boolean;
}

interface ChangeAnglePanelProps {
    imageUrl: string;
    settings: AngleSettings;
    onSettingsChange: (settings: AngleSettings) => void;
    onClose: () => void;
    onGenerate: () => void;
    isLoading?: boolean;
    canvasTheme?: 'dark' | 'light';
    errorMessage?: string;
}

const SUBJECT_DEFAULTS: AngleSettings = { mode: 'subject', rotation: 45, tilt: -30, scale: 50, wideAngle: false };
const CAMERA_DEFAULTS: AngleSettings = { mode: 'camera', rotation: -45, tilt: -30, scale: 50, wideAngle: false };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const DIRECTION_STEP = 15;

function snapZoom(raw: number): number {
    if (raw <= 33) return 0;
    if (raw <= 66) return 50;
    return 100;
}

function describeZoom(value: number) {
    if (value >= 67) return '特写';
    if (value >= 34) return '中等';
    return '广角';
}

const sliderClassName =
    'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e7e7ef] accent-[#1f1f1f]';

export const ChangeAnglePanel: React.FC<ChangeAnglePanelProps> = ({
    imageUrl,
    settings,
    onSettingsChange,
    onClose,
    onGenerate,
    isLoading = false,
    errorMessage,
}) => {
    const endpointConfigured = isEndpointConfigured();
    const usesXiaolouModelPool = getRuntimeConfig().isEmbedded;
    const activeMode = settings.mode || 'camera';
    const zoomLabel = useMemo(() => describeZoom(settings.scale), [settings.scale]);

    const handleReset = useCallback(() => {
        onSettingsChange(activeMode === 'subject' ? { ...SUBJECT_DEFAULTS } : { ...CAMERA_DEFAULTS });
    }, [activeMode, onSettingsChange]);

    const handleModeChange = useCallback((mode: 'subject' | 'camera') => {
        const defaults = mode === 'subject' ? SUBJECT_DEFAULTS : CAMERA_DEFAULTS;
        onSettingsChange({ ...defaults });
    }, [onSettingsChange]);

    const handleRotationChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onSettingsChange({
            ...settings,
            rotation: clamp(Number(event.target.value), ANGLE_ROTATION_MIN, ANGLE_ROTATION_MAX),
        });
    }, [onSettingsChange, settings]);

    const handleTiltChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onSettingsChange({
            ...settings,
            tilt: clamp(Number(event.target.value), ANGLE_TILT_MIN, ANGLE_TILT_MAX),
        });
    }, [onSettingsChange, settings]);

    const handleScaleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const snapped = snapZoom(Number(event.target.value));
        onSettingsChange({ ...settings, scale: snapped });
    }, [onSettingsChange, settings]);

    const handleDirection = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
        const next = { ...settings };
        switch (dir) {
            case 'up':
                next.tilt = clamp(settings.tilt + DIRECTION_STEP, ANGLE_TILT_MIN, ANGLE_TILT_MAX);
                break;
            case 'down':
                next.tilt = clamp(settings.tilt - DIRECTION_STEP, ANGLE_TILT_MIN, ANGLE_TILT_MAX);
                break;
            case 'left':
                next.rotation = clamp(settings.rotation - DIRECTION_STEP, ANGLE_ROTATION_MIN, ANGLE_ROTATION_MAX);
                break;
            case 'right':
                next.rotation = clamp(settings.rotation + DIRECTION_STEP, ANGLE_ROTATION_MIN, ANGLE_ROTATION_MAX);
                break;
        }
        onSettingsChange(next);
    }, [onSettingsChange, settings]);

    const helperText = errorMessage
        ? errorMessage
        : !endpointConfigured
            ? '当前多角度生成接口未就绪，面板可以正常预览和调节，但暂时不能出图。'
            : usesXiaolouModelPool
                ? activeMode === 'subject'
                    ? '主体模式：拖动旋转主体立方体角度，镜头保持稳定。'
                    : '摄像头模式：拖动调节摄像机绕球面的位置。'
                : activeMode === 'subject'
                    ? '主体模式：拖动调整主体角度。'
                    : '摄像头模式：拖动调整摄像机角度。';

    return (
        <div
            className="w-[260px] cursor-default rounded-xl border border-[#e8e8e8] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.1)]"
            onPointerDown={(e) => e.stopPropagation()}
        >
            {/* header */}
            <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0f0] px-4">
                <span className="flex-1 text-sm font-semibold text-black/50">多角度</span>
                <button
                    type="button"
                    onClick={handleReset}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-black/60 transition hover:bg-black/5"
                    title="重置"
                >
                    <RotateCcw size={14} />
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-black/60 transition hover:bg-black/5"
                    title="关闭"
                >
                    <X size={14} />
                </button>
            </div>

            {/* content */}
            <div className="flex flex-col gap-4 p-3">
                {/* mode switch */}
                <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-black/[0.03] p-0.5">
                    <button
                        type="button"
                        onClick={() => handleModeChange('subject')}
                        className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                            activeMode === 'subject'
                                ? 'bg-white text-[#111827] shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                                : 'text-black/50 hover:text-black/90'
                        }`}
                    >
                        主体
                    </button>
                    <button
                        type="button"
                        onClick={() => handleModeChange('camera')}
                        className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                            activeMode === 'camera'
                                ? 'bg-white text-[#111827] shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                                : 'text-black/50 hover:text-black/90'
                        }`}
                    >
                        摄像头
                    </button>
                </div>

                {/* 3D scene + direction buttons */}
                <div className="relative">
                    <OrbitCameraControl
                        imageUrl={imageUrl}
                        mode={activeMode}
                        rotation={settings.rotation}
                        tilt={settings.tilt}
                        zoom={settings.scale}
                        onRotationChange={(rotation) =>
                            onSettingsChange({
                                ...settings,
                                rotation: clamp(rotation, ANGLE_ROTATION_MIN, ANGLE_ROTATION_MAX),
                            })
                        }
                        onTiltChange={(tilt) =>
                            onSettingsChange({
                                ...settings,
                                tilt: clamp(tilt, ANGLE_TILT_MIN, ANGLE_TILT_MAX),
                            })
                        }
                        onZoomChange={(scale) =>
                            onSettingsChange({ ...settings, scale: clamp(scale, 0, 100) })
                        }
                    />

                    {/* direction buttons (camera mode) */}
                    {activeMode === 'camera' && (
                        <div className="pointer-events-none absolute inset-0 z-20">
                            <button
                                type="button"
                                onClick={() => handleDirection('up')}
                                className="pointer-events-auto absolute left-1/2 top-2 -translate-x-1/2 rounded-full p-1 text-black/50 transition hover:bg-black/5 hover:text-black/80"
                            >
                                <ChevronUp size={20} />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDirection('down')}
                                className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-1 text-black/50 transition hover:bg-black/5 hover:text-black/80"
                            >
                                <ChevronDown size={20} />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDirection('left')}
                                className="pointer-events-auto absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-black/50 transition hover:bg-black/5 hover:text-black/80"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDirection('right')}
                                className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-black/50 transition hover:bg-black/5 hover:text-black/80"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    )}
                </div>

                {/* sliders */}
                <div className="space-y-3">
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[13px] text-black/90">旋转</span>
                            <span className="text-[13px] text-black/50">{Math.round(settings.rotation)}</span>
                        </div>
                        <input
                            type="range"
                            min={ANGLE_ROTATION_MIN}
                            max={ANGLE_ROTATION_MAX}
                            step={1}
                            value={settings.rotation}
                            onChange={handleRotationChange}
                            className={sliderClassName}
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[13px] text-black/90">倾斜</span>
                            <span className="text-[13px] text-black/50">{Math.round(settings.tilt)}</span>
                        </div>
                        <input
                            type="range"
                            min={ANGLE_TILT_MIN}
                            max={ANGLE_TILT_MAX}
                            step={1}
                            value={settings.tilt}
                            onChange={handleTiltChange}
                            className={sliderClassName}
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[13px] text-black/90">缩放</span>
                            <span className="text-[13px] text-black/50">{zoomLabel}</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={settings.scale}
                            onChange={handleScaleChange}
                            className={sliderClassName}
                        />
                    </div>
                </div>
            </div>

            {/* helper */}
            <div className="px-3 pb-3">
                <div
                    className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                        errorMessage
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : !endpointConfigured
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-[#e6eefc] bg-[#f5f8ff] text-[#52627b]'
                    }`}
                >
                    <div className="flex items-start gap-2">
                        <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                        {errorMessage ? (
                            // Error case: surface a clear title + the full
                            // `[CODE] 原因\n详情：…` block, wrap long lines and
                            // keep newlines so the backend's Chinese hint and
                            // the raw English detail are both visible. Mirrors
                            // the red overlay used by /create/image and
                            // /create/video task cards.
                            <div className="min-w-0 flex-1">
                                <div className="font-medium">多角度生成失败</div>
                                <div className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5">
                                    {helperText}
                                </div>
                                <div className="mt-1 text-[10px] text-red-500/80">
                                    可调节参数后再次点击"立即使用"重试。
                                </div>
                            </div>
                        ) : (
                            <div>{helperText}</div>
                        )}
                    </div>
                </div>
            </div>

            {/* actions */}
            <div className="flex gap-2 border-t border-[#f0f0f0] px-3 py-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-lg border border-[#e0e0e0] bg-transparent px-3 py-2 text-sm font-medium text-black/90 transition hover:bg-black/[0.03]"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={onGenerate}
                    disabled={isLoading || !endpointConfigured}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isLoading || !endpointConfigured
                            ? 'cursor-not-allowed bg-[#d9dbe3] text-[#7c8595]'
                            : 'bg-black/90 text-white hover:bg-black/70'
                    }`}
                >
                    {isLoading ? '生成中...' : '立即使用'}
                </button>
            </div>
        </div>
    );
};

export default ChangeAnglePanel;
