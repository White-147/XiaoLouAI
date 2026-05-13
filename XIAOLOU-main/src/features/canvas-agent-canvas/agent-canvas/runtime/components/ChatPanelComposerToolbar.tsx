import {
    ChatPanelComposerToolbarActions,
    type ChatPanelComposerToolbarActionsProps,
} from './ChatPanelComposerToolbarActions';
import {
    ChatPanelComposerToolbarControls,
    type ChatPanelComposerToolbarControlsProps,
} from './ChatPanelComposerToolbarControls';

export type ChatPanelComposerToolbarProps = {
    controls: ChatPanelComposerToolbarControlsProps;
    actions: ChatPanelComposerToolbarActionsProps;
};

export function ChatPanelComposerToolbar({
    controls,
    actions,
}: ChatPanelComposerToolbarProps) {
    return (
        <div className="mt-2 flex items-center justify-between gap-2">
            <ChatPanelComposerToolbarControls {...controls} />
            <ChatPanelComposerToolbarActions {...actions} />
        </div>
    );
}
