import type { Storyboard } from "../../../lib/api";

type StoryboardShotPromptEditorProps = {
  item: Storyboard;
  draftPrompt: string;
  onUpdateDraftPrompt: (shotId: string, value: string) => void;
  onBlurSave: (item: Storyboard) => void | Promise<void>;
};

export function StoryboardShotPromptEditor({
  item,
  draftPrompt,
  onUpdateDraftPrompt,
  onBlurSave,
}: StoryboardShotPromptEditorProps) {
  return (
    <textarea
      value={draftPrompt}
      onChange={(event) => onUpdateDraftPrompt(item.id, event.target.value)}
      onBlur={() => void onBlurSave(item)}
      rows={4}
      className="w-full resize-none rounded-lg border border-transparent bg-white/[0.04] p-2.5 text-xs leading-relaxed transition-colors placeholder:text-muted-foreground/40 focus:border-border focus:outline-none"
      placeholder="分镜提示词..."
    />
  );
}
