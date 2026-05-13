import { BookOpen, Video } from 'lucide-react';
import type {
    AgentCanvasSkill,
    AgentCanvasSkillCategory,
} from '../config/agentCanvasSkills';

type ChatPanelSkillsMenuProps = {
    categories: AgentCanvasSkillCategory[];
    skills: AgentCanvasSkill[];
    activeCategoryId: string;
    selectedSkillId?: string | null;
    onCategoryChange: (categoryId: string) => void;
    onSkillSelect: (skill: AgentCanvasSkill) => void;
};

export function ChatPanelSkillsMenu({
    categories,
    skills,
    activeCategoryId,
    selectedSkillId,
    onCategoryChange,
    onSkillSelect,
}: ChatPanelSkillsMenuProps) {
    const visibleSkills = skills.filter((skill) => skill.category === activeCategoryId);

    return (
        <div className="absolute bottom-11 left-[-48px] z-50 w-[392px] rounded-xl border border-neutral-100 bg-white p-4 shadow-2xl">
            <div className="mb-3 text-sm font-semibold text-neutral-950">Skills</div>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {categories.map((category) => (
                    <button
                        key={category.id}
                        type="button"
                        onClick={() => onCategoryChange(category.id)}
                        className={`inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-xs transition-colors ${activeCategoryId === category.id
                            ? 'border-neutral-900 bg-neutral-950 text-white'
                            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                        }`}
                    >
                        {category.label}
                    </button>
                ))}
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                <div className="flex items-start gap-3 rounded-xl bg-neutral-50 px-3 py-3 text-neutral-400">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white">
                        <BookOpen size={15} />
                    </div>
                    <div>
                        <div className="text-sm">基于此对话创建 Skill</div>
                        <div className="mt-1 text-xs">在 Thinking 模式下将对话总结为可复用的 Skill</div>
                    </div>
                </div>
                {visibleSkills.map((skill) => (
                    <button
                        key={skill.id}
                        type="button"
                        onClick={() => onSkillSelect(skill)}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${selectedSkillId === skill.id ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                    >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                            <Video size={15} />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-medium text-neutral-950">{skill.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">{skill.description}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
