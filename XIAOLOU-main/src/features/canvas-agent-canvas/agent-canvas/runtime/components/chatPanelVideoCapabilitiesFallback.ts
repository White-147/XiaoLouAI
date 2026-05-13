import { buildFallbackVideoCapabilities } from '../config/canvasVideoModels';
import type { BridgeMediaModelCapability } from '../types';
import {
    VIDEO_CAPABILITY_API_MODES,
} from './chatPanelVideoOptions';
import { isVideoCapabilitySetAvailable } from './useChatPanelVideoCapabilities';
import type { VideoApiMode } from './useChatPanelVideoGeneration';

function isVideoCapabilityAvailableForApiMode(
    apiMode: VideoApiMode,
    capability: BridgeMediaModelCapability,
) {
    if (apiMode === 'image_to_video') {
        return isVideoCapabilitySetAvailable(capability.inputModes.text_to_video) ||
            isVideoCapabilitySetAvailable(capability.inputModes.single_reference);
    }
    return isVideoCapabilitySetAvailable(capability.inputModes[apiMode as keyof typeof capability.inputModes]);
}

export function buildFallbackVideoCapabilityMap(): Record<VideoApiMode, BridgeMediaModelCapability[]> {
    const fallbackCapabilities = buildFallbackVideoCapabilities();
    return Object.fromEntries(
        VIDEO_CAPABILITY_API_MODES.map((mode) => [
            mode,
            fallbackCapabilities.filter((capability) => isVideoCapabilityAvailableForApiMode(mode, capability)),
        ]),
    ) as Record<VideoApiMode, BridgeMediaModelCapability[]>;
}
