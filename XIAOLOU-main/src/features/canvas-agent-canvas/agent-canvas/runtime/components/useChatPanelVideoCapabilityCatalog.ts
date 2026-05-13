import { useEffect, useState } from 'react';

import {
    canUseXiaolouImageGenerationBridge,
    getVideoCapabilitiesFromXiaolou,
} from '../integrations/xiaolouGenerationBridge';
import type { BridgeMediaModelCapability } from '../types';
import { buildFallbackVideoCapabilityMap } from './chatPanelVideoCapabilitiesFallback';
import { VIDEO_CAPABILITY_API_MODES } from './chatPanelVideoOptions';

export function useChatPanelVideoCapabilityCatalog() {
    const [videoCapabilities, setVideoCapabilities] = useState<Record<string, BridgeMediaModelCapability[]>>({});
    const [isLoadingVideoCapabilities, setIsLoadingVideoCapabilities] = useState(false);
    const [videoCapabilityError, setVideoCapabilityError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const loadVideoCapabilities = async () => {
            setIsLoadingVideoCapabilities(true);
            setVideoCapabilityError(null);
            const applyFallbackCapabilities = () => {
                setVideoCapabilities(buildFallbackVideoCapabilityMap());
                setVideoCapabilityError(null);
            };

            try {
                if (!canUseXiaolouImageGenerationBridge()) {
                    if (!cancelled) {
                        applyFallbackCapabilities();
                    }
                    return;
                }

                const entries = await Promise.all(
                    VIDEO_CAPABILITY_API_MODES.map(async (mode) => {
                        const response = await getVideoCapabilitiesFromXiaolou(mode);
                        return [mode, response.items || []] as const;
                    }),
                );
                if (!cancelled) {
                    setVideoCapabilities(Object.fromEntries(entries));
                }
            } catch (err) {
                if (!cancelled) {
                    setVideoCapabilityError(err instanceof Error ? err.message : '视频能力加载失败');
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingVideoCapabilities(false);
                }
            }
        };

        void loadVideoCapabilities();

        return () => {
            cancelled = true;
        };
    }, []);

    return {
        videoCapabilities,
        isLoadingVideoCapabilities,
        videoCapabilityError,
        setVideoCapabilityError,
    };
}
