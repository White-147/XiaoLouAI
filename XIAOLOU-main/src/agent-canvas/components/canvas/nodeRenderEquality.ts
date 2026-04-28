import { NodeData, NodeType } from '../../types';

export type ConnectedCanvasNodeInput = {
    id: string;
    url: string;
    type?: NodeType;
};

const POSITION_KEYS = new Set<keyof NodeData>(['x', 'y']);

export function areNodeDataEqualExceptPosition(prev: NodeData, next: NodeData) {
    if (prev === next) return true;

    const prevKeys = Object.keys(prev) as Array<keyof NodeData>;
    const nextKeys = Object.keys(next) as Array<keyof NodeData>;

    if (prevKeys.length !== nextKeys.length) return false;

    for (const key of prevKeys) {
        if (POSITION_KEYS.has(key)) continue;
        if (prev[key] !== next[key]) return false;
    }

    return true;
}

export function areConnectedCanvasNodeInputsEqual(
    prev: ConnectedCanvasNodeInput[] | undefined,
    next: ConnectedCanvasNodeInput[] | undefined
) {
    if (prev === next) return true;
    if (!prev || !next) return !prev && !next;
    if (prev.length !== next.length) return false;

    for (let i = 0; i < prev.length; i += 1) {
        const prevItem = prev[i];
        const nextItem = next[i];
        if (
            prevItem.id !== nextItem.id ||
            prevItem.url !== nextItem.url ||
            prevItem.type !== nextItem.type
        ) {
            return false;
        }
    }

    return true;
}
