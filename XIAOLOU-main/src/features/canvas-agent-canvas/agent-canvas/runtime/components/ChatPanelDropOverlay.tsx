import { Sparkles } from 'lucide-react';

export function ChatPanelDropOverlay() {
    return (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-blue-500/10">
            <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/95 px-8 py-6 text-center shadow-lg">
                <Sparkles className="mx-auto mb-2 h-10 w-10 text-blue-500" />
                <p className="font-medium text-blue-700">将图片或视频拖到这里作为参考</p>
            </div>
        </div>
    );
}
