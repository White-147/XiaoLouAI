import { AlertCircle, Check, Loader2 } from 'lucide-react';

import type { AgentActivityEvent } from '../hooks/useChatAgent';

type ChatPanelAgentActivityPanelProps = {
    events: AgentActivityEvent[];
    pending?: boolean;
};

function getActivityPhaseLabel(phase: AgentActivityEvent['phase']) {
    if (phase === 'USING_TOOLS') return 'USING TOOLS';
    return phase;
}

function isTransportActivityEvent(event: AgentActivityEvent) {
    const value = `${event.title || ''} ${event.detail || ''}`.toLowerCase();
    return value.includes('sse') || value.includes('streaming') || value.includes('事件流');
}

export function ChatPanelAgentActivityPanel({
    events,
    pending = false,
}: ChatPanelAgentActivityPanelProps) {
    if (events.length === 0 && !pending) return null;

    const fallbackEvent: AgentActivityEvent = {
        id: 'agent-activity-pending',
        phase: 'THINKING',
        title: '模型正在思考...',
        detail: '正在等待模型和 Agent 过程事件',
        status: 'active',
        timestamp: new Date(),
    };
    const displayEvents = (events.length > 0 ? events : [fallbackEvent])
        .filter((event) => !isTransportActivityEvent(event));
    if (displayEvents.length === 0) return null;
    const visibleEvents = displayEvents.slice(-8);
    const currentActivity = [...displayEvents].reverse().find((event) => event.status === 'active') || displayEvents[displayEvents.length - 1];
    const progressLabel =
        currentActivity?.status === 'active'
            ? '进行中'
            : currentActivity?.status === 'error'
                ? '已中断'
                : '已完成';
    const progressLabelClassName =
        currentActivity?.status === 'active'
            ? 'bg-neutral-950 text-white'
            : currentActivity?.status === 'error'
                ? 'bg-red-50 text-red-600'
                : 'bg-emerald-50 text-emerald-600';
    const latestStreamEvent = [...displayEvents].reverse().find((event) => event.streamText);
    const streamEvent = latestStreamEvent;
    const currentStreamText = streamEvent?.streamText || '';
    const streamLabel = streamEvent?.streamMeta?.includes('Provider：langgraph')
        ? 'AGENT THINKING STREAM'
        : (streamEvent?.streamKind === 'reasoning' ? 'MODEL THINKING STREAM' : 'MODEL OUTPUT STREAM');

    return (
        <div className="rounded-2xl border border-violet-100 bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
            {currentStreamText && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-950 px-3 py-2.5 text-xs leading-5 text-neutral-50 shadow-inner">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                        <span>{streamLabel}</span>
                        {streamEvent?.streamMeta && <span className="truncate normal-case tracking-normal">{streamEvent.streamMeta}</span>}
                    </div>
                    <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-mono">
                        {currentStreamText}
                        {streamEvent?.status === 'active' && <span className="ml-0.5 animate-pulse text-lime-300">▌</span>}
                    </div>
                </div>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                    Agent 过程
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${progressLabelClassName}`}>
                    {progressLabel}
                </span>
            </div>

            <div className="mt-2 space-y-2">
                {visibleEvents.map((event) => (
                    <div key={event.id} className="flex gap-2.5">
                        <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                            event.status === 'active'
                                ? 'bg-neutral-900 text-white'
                                : event.status === 'error'
                                    ? 'bg-red-50 text-red-500'
                                    : 'bg-neutral-100 text-neutral-500'
                        }`}>
                            {event.status === 'active' ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : event.status === 'error' ? (
                                <AlertCircle className="h-2.5 w-2.5" />
                            ) : (
                                <Check className="h-2.5 w-2.5" />
                            )}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-xs font-medium text-neutral-800">
                                    {event.title}
                                </span>
                                <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] text-neutral-400">
                                    {getActivityPhaseLabel(event.phase)}
                                </span>
                            </div>
                            {(event.streamText || event.detail) && (
                                <div className={`mt-0.5 text-xs leading-5 text-neutral-500 ${
                                    event.streamText
                                        ? 'max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 px-2 py-1.5 font-mono'
                                        : 'line-clamp-2'
                                }`}>
                                    {event.streamText || event.detail}
                                    {event.streamText && event.status === 'active' && <span className="ml-0.5 animate-pulse text-neutral-900">▌</span>}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
