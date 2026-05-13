import { Banana, Box, Sparkles, Video } from 'lucide-react';

import {
    getModelBrandKey,
    getModelOptionFingerprint,
    type ComposerModelOption,
} from './chatPanelModelOptions';
import {
    BlackForestLabsIcon,
    GeminiIcon,
    GoogleIcon,
    KlingMonoIcon,
    OpenAIIcon,
    PixVerseIcon,
    QwenIcon,
    SeedIcon,
} from './icons/BrandIcons';

export function getModelOptionIcon(
    option: ComposerModelOption,
    size = 16,
    className = 'shrink-0 text-neutral-900',
): React.ReactNode {
    switch (getModelBrandKey(option)) {
        case 'nano-banana':
            return <Banana size={size} strokeWidth={1.85} className={className} />;
        case 'openai':
            return <OpenAIIcon size={size} className={className} />;
        case 'bfl':
            return <BlackForestLabsIcon size={size} className={className} />;
        case 'seed':
            return <SeedIcon size={size} className={className} />;
        case 'qwen':
            return <QwenIcon size={size} className={className} />;
        case 'google':
            return /veo/.test(getModelOptionFingerprint(option))
                ? <GoogleIcon size={size} className={className} />
                : <GeminiIcon size={size} className={className} />;
        case 'kling':
            return <KlingMonoIcon size={size} className={className} />;
        case 'pixverse':
            return <PixVerseIcon size={size} className={className} />;
        case 'grok':
            return <Box size={size} strokeWidth={1.85} className={className} />;
        default:
            return option.kind === 'video'
                ? <Video size={size} strokeWidth={1.85} className={className} />
                : <Sparkles size={size} strokeWidth={1.85} className={className} />;
    }
}
