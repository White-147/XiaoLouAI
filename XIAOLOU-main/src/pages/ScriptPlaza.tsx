import { BookOpen, LoaderCircle, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { createProject, updateScript } from "../lib/api";
import { setCurrentProjectId } from "../lib/session";

type PlazaScript = {
  id: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  summary: string;
  scriptSeed: string;
};

const CATEGORIES = ["全部", "科幻", "悬疑", "古风", "都市", "热血"];

const SCRIPTS: PlazaScript[] = [
  {
    id: "script_001",
    title: "霓虹街区追踪",
    author: "小楼内容库",
    category: "科幻",
    tags: ["赛博", "追逐", "夜景"],
    summary: "适合拆成快节奏都市追踪漫剧，角色与场景都比较鲜明。",
    scriptSeed:
      "雨夜的霓虹街区中，少女侦探追踪一名神秘信使。她穿过拥挤的人群，最终在废弃天桥上发现对方留下的芯片与一封未署名的信。",
  },
  {
    id: "script_002",
    title: "旧宅回声",
    author: "小楼内容库",
    category: "悬疑",
    tags: ["老宅", "回忆", "反转"],
    summary: "适合双人对话与空间探索类镜头，配音和口型表现会比较突出。",
    scriptSeed:
      "深夜，姐弟二人回到多年未住的祖宅。破旧的收音机突然自动响起，广播中传出母亲年轻时的声音，引导他们逐步打开尘封的房间。",
  },
  {
    id: "script_003",
    title: "长安夜雪",
    author: "小楼内容库",
    category: "古风",
    tags: ["宫灯", "雪夜", "古装"],
    summary: "适合古风风格模板，场景、服装与镜头氛围都比较容易建立统一视觉。",
    scriptSeed:
      "大雪夜，女官提灯穿过长安宫道，将一封密信送往偏殿。途中她与一名受伤的禁军相遇，二人短暂结盟，共同避开巡夜侍卫。",
  },
  {
    id: "script_004",
    title: "最后一局",
    author: "小楼内容库",
    category: "热血",
    tags: ["电竞", "团队", "逆风"],
    summary: "适合多镜头切换与快节奏配乐，也适合作为动作迁移测试素材。",
    scriptSeed:
      "决赛局进入最后一分钟，队伍陷入巨大劣势。指挥强行冷静下来，重新分配任务，所有队员完成一次近乎完美的团战反扑。",
  },
];

export default function ScriptPlaza() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    return SCRIPTS.filter((item) => {
      const matchCategory =
        activeCategory === "全部" || item.category === activeCategory;
      const matchQuery =
        !query ||
        item.title.includes(query) ||
        item.author.includes(query) ||
        item.tags.some((tag) => tag.includes(query));

      return matchCategory && matchQuery;
    });
  }, [activeCategory, query]);

  const handleAdapt = async (item: PlazaScript) => {
    setPendingId(item.id);

    try {
      const project = await createProject({
        title: `${item.title} 漫剧项目`,
        summary: item.summary,
      });

      await updateScript(project.id, item.scriptSeed);
      setCurrentProjectId(project.id);
      navigate("/comic/script");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-8">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">剧本广场</h1>
            <p className="text-sm text-muted-foreground">
              选择一个剧本模板，直接创建后端项目并写入故事剧本。
            </p>
          </div>
        </div>

        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、作者或标签"
            className="w-full rounded-full border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-background px-8 py-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                activeCategory === category
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const pending = pendingId === item.id;

            return (
              <article
                key={item.id}
                className="glass-panel flex flex-col overflow-hidden rounded-2xl"
              >
                <div className="aspect-[4/3] bg-muted">
                  <img
                    src={`https://picsum.photos/seed/${item.id}/640/480`}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {item.category}
                    </span>
                    <span className="text-xs text-muted-foreground">{item.author}</span>
                  </div>

                  <h2 className="mb-2 text-lg font-semibold">{item.title}</h2>
                  <p className="mb-4 flex-1 text-sm text-muted-foreground">
                    {item.summary}
                  </p>

                  <div className="mb-4 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-secondary px-2 py-1 text-[11px] text-secondary-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => void handleAdapt(item)}
                    disabled={pending}
                    className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {pending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    一键改编漫剧
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
            <BookOpen className="mb-4 h-12 w-12 opacity-20" />
            <p>没有匹配的剧本模板</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
