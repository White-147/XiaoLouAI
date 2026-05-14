import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import {
  BookOpen,
  Box,
  Check,
  ChevronDown,
  Lightbulb,
  LoaderCircle,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type { PlaygroundChatJob, PlaygroundModel } from "../../lib/api";
import { cn } from "../../lib/utils";
import {
  composerModes,
  modelLabel,
  skillCategories,
  type ComposerMode,
  type PlaygroundSkill,
} from "./playgroundDisplay";

type PlaygroundComposerProps = {
  compact?: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  canUsePlayground: boolean;
  activeConversationJob: PlaygroundChatJob | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
  selectedSkill: PlaygroundSkill | null;
  setSelectedSkill: Dispatch<SetStateAction<PlaygroundSkill | null>>;
  skillMenuOpen: boolean;
  setSkillMenuOpen: Dispatch<SetStateAction<boolean>>;
  activeSkillCategory: string;
  setActiveSkillCategory: Dispatch<SetStateAction<string>>;
  visibleSkills: PlaygroundSkill[];
  chooseSkill: (skill: PlaygroundSkill) => void;
  composerMode: ComposerMode;
  setComposerMode: Dispatch<SetStateAction<ComposerMode>>;
  modeMenuOpen: boolean;
  setModeMenuOpen: Dispatch<SetStateAction<boolean>>;
  thinkingModeEnabled: boolean;
  setThinkingModeEnabled: Dispatch<SetStateAction<boolean>>;
  models: PlaygroundModel[];
  selectedModel: string;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  modelMenuOpen: boolean;
  setModelMenuOpen: Dispatch<SetStateAction<boolean>>;
  isBusy: boolean;
  sending: boolean;
};

export function PlaygroundComposer({
  compact = false,
  input,
  setInput,
  canUsePlayground,
  activeConversationJob,
  onSubmit,
  selectedSkill,
  setSelectedSkill,
  skillMenuOpen,
  setSkillMenuOpen,
  activeSkillCategory,
  setActiveSkillCategory,
  visibleSkills,
  chooseSkill,
  composerMode,
  setComposerMode,
  modeMenuOpen,
  setModeMenuOpen,
  thinkingModeEnabled,
  setThinkingModeEnabled,
  models,
  selectedModel,
  setSelectedModel,
  modelMenuOpen,
  setModelMenuOpen,
  isBusy,
  sending,
}: PlaygroundComposerProps) {
  const activeMode = composerModes.find((mode) => mode.value === composerMode) || composerModes[0];
  const ActiveModeIcon = activeMode.icon;
  const selectedModelName =
    models.find((model) => model.id === selectedModel)?.name || selectedModel || "Qwen Plus";

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_18px_50px_rgba(24,24,27,0.10)] transition focus-within:border-neutral-300 dark:border-border dark:bg-card">
        {selectedSkill ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selectedSkill.title}</span>
              <button
                type="button"
                onClick={() => setSelectedSkill(null)}
                className="ml-0.5 rounded-full p-0.5 text-blue-500 transition hover:bg-blue-100 hover:text-blue-800"
                aria-label="取消 Skill"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : null}

        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          disabled={!canUsePlayground || Boolean(activeConversationJob)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={canUsePlayground ? "写下你的想法、任务或要创作的内容..." : "请先登录后使用 Playground"}
          rows={compact ? 2 : 4}
          className={cn(
            "w-full resize-none bg-transparent px-1 text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400 dark:text-foreground",
            compact ? "min-h-14" : "min-h-28",
          )}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setSkillMenuOpen((open) => !open);
                  setModelMenuOpen(false);
                  setModeMenuOpen(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                  skillMenuOpen || selectedSkill
                    ? "bg-blue-50 text-blue-700"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={skillMenuOpen}
              >
                <BookOpen className="h-4 w-4" />
                Skills
              </button>

              {skillMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  <div className="border-b border-neutral-100 px-3 py-2 dark:border-border">
                    <div className="text-sm font-semibold">Skills</div>
                    <div className="mt-1 text-xs text-neutral-500">选择一个创意处理方式。</div>
                  </div>
                  <div className="flex gap-1 overflow-x-auto border-b border-neutral-100 px-2 py-2 dark:border-border">
                    {skillCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveSkillCategory(category.id)}
                        className={cn(
                          "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition",
                          activeSkillCategory === category.id
                            ? "bg-neutral-950 text-white dark:bg-primary dark:text-primary-foreground"
                            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground",
                        )}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {visibleSkills.map((skill) => {
                      const selected = selectedSkill?.id === skill.id;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => chooseSkill(skill)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                            selected ? "bg-blue-50 text-blue-700" : "hover:bg-neutral-50 dark:hover:bg-accent",
                          )}
                        >
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{skill.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">
                              {skill.description}
                            </span>
                          </span>
                          {selected ? <Check className="ml-auto h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModeMenuOpen((open) => !open);
                  setSkillMenuOpen(false);
                  setModelMenuOpen(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                  modeMenuOpen
                    ? "bg-neutral-950 text-white"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={modeMenuOpen}
              >
                <ActiveModeIcon className="h-4 w-4" />
                {activeMode.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {modeMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-64 rounded-2xl border border-neutral-200 bg-white p-2 text-sm text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  {composerModes.map((mode) => {
                    const Icon = mode.icon;
                    const selected = composerMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => {
                          setComposerMode(mode.value);
                          setModeMenuOpen(false);
                          if (mode.value !== "agent") setSelectedSkill(null);
                        }}
                        className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-neutral-50 dark:hover:bg-accent"
                      >
                        <span className="flex min-w-0 gap-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            <span className="block font-medium">{mode.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">
                              {mode.description}
                            </span>
                          </span>
                        </span>
                        {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setThinkingModeEnabled((enabled) => !enabled)}
              aria-pressed={thinkingModeEnabled}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                thinkingModeEnabled
                  ? "bg-neutral-950 text-white"
                  : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
              )}
              title="思考模式"
            >
              <Lightbulb className="h-4 w-4" />
              {thinkingModeEnabled ? "深度思考" : "思考"}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModelMenuOpen((open) => !open);
                  setSkillMenuOpen(false);
                  setModeMenuOpen(false);
                }}
                disabled={models.length === 0}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                  modelMenuOpen
                    ? "bg-neutral-950 text-white"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={modelMenuOpen}
                aria-label="选择模型"
                title={`模型：${selectedModelName}`}
              >
                <Box className="h-4 w-4" />
                <span className="max-w-28 truncate">{selectedModelName}</span>
              </button>

              {modelMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  <div className="border-b border-neutral-100 px-3 py-2.5 dark:border-border">
                    <div className="text-sm font-semibold">模型选择</div>
                    <div className="mt-1 text-xs text-neutral-500">用于当前 Playground 对话。</div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {models.map((model) => {
                      const active = selectedModel === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                          }}
                          disabled={isBusy}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                            active ? "bg-blue-50 text-blue-700" : "text-neutral-800 hover:bg-neutral-50 dark:text-foreground dark:hover:bg-accent",
                          )}
                        >
                          <Box className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{modelLabel(model)}</span>
                            <span className="block truncate text-[11px] text-neutral-500">
                              {model.provider || "Playground"}
                            </span>
                          </span>
                          {active ? <Check className="h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={!canUsePlayground || isBusy || !input.trim()}
            className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-primary dark:text-primary-foreground"
            aria-label="发送"
          >
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </form>
  );
}
