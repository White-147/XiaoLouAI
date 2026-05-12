import { ScriptEditorPane, type ScriptEditorPaneProps } from "./ScriptEditorPane";
import { StoryboardShotList, type StoryboardShotListProps } from "./StoryboardShotList";

type ScriptBreakdownWorkspaceProps = {
  editorPane: ScriptEditorPaneProps;
  shotList: StoryboardShotListProps;
};

export function ScriptBreakdownWorkspace({
  editorPane,
  shotList,
}: ScriptBreakdownWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <ScriptEditorPane {...editorPane} />
      <StoryboardShotList {...shotList} />
    </div>
  );
}
