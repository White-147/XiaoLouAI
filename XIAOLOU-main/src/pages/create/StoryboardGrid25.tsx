import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AtSign,
  Check,
  Cpu,
  Download,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useCurrentProjectId } from "../../lib/session";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  uploadFile,
  generateStoryboardGrid25,
  type StoryboardGrid25Reference,
} from "../../lib/api";
import { useActorId } from "../../lib/actor-session";
import { parseGenerationError } from "../../lib/generation-error";

const GEMINI_MODEL_ID = "vertex:gemini-3-pro-image-preview";
const GEMINI_MODEL_LABEL = "Gemini 3 Pro Image";
const MAX_REFS = 8;
const STORYBOARD_GRID25_DRAFT_KEY_PREFIX = "xiaolou-storyboard-grid25-draft";

// ── Types ─────────────────────────────────────────────────────────────────────

type RefEntry = {
  id: string;
  name: string;
  url: string | null;
  isUploading: boolean;
};

type StoryboardGrid25Draft = {
  version: 1;
  refs: Array<Pick<RefEntry, "id" | "name" | "url">>;
  plotText: string;
  generatedImage: string | null;
  errorText: string | null;
  updatedAt: number;
};

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultName(index: number) {
  const labels = ["主角", "配角", "场景", "道具", "反派", "背景", "动作", "特效"];
  return labels[index] ?? `引用${index + 1}`;
}

// ── @ Autocomplete helper ─────────────────────────────────────────────────────

function buildDefaultRefs(): RefEntry[] {
  return [{ id: makeId(), name: defaultName(0), url: null, isUploading: false }];
}

function normalizeDraftRef(value: unknown, index: number): RefEntry | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as Record<string, unknown>;
  const name =
    typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim().replace(/^@+/, "")
      : defaultName(index);
  const url =
    typeof entry.url === "string" && entry.url.trim()
      ? entry.url.trim()
      : null;
  const id =
    typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : makeId();

  return {
    id,
    name,
    url,
    isUploading: false,
  };
}

function normalizeDraftRefs(value: unknown): RefEntry[] {
  if (!Array.isArray(value)) return buildDefaultRefs();

  const refs = value
    .map((item, index) => normalizeDraftRef(item, index))
    .filter((item): item is RefEntry => Boolean(item))
    .slice(0, MAX_REFS);

  return refs.length ? refs : buildDefaultRefs();
}

function getStoryboardGrid25DraftKey(actorId: string | null | undefined, projectId: string | null | undefined) {
  const normalizedActorId = typeof actorId === "string" && actorId.trim() ? actorId.trim() : "guest";
  const normalizedProjectId =
    typeof projectId === "string" && projectId.trim() ? projectId.trim() : "global";
  return `${STORYBOARD_GRID25_DRAFT_KEY_PREFIX}:${normalizedActorId}:${normalizedProjectId}`;
}

function readStoryboardGrid25Draft(storageKey: string): StoryboardGrid25Draft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoryboardGrid25Draft> | null;
    if (!parsed || typeof parsed !== "object") return null;

    return {
      version: 1,
      refs: normalizeDraftRefs(parsed.refs).map(({ id, name, url }) => ({ id, name, url })),
      plotText: typeof parsed.plotText === "string" ? parsed.plotText : "",
      generatedImage:
        typeof parsed.generatedImage === "string" && parsed.generatedImage.trim()
          ? parsed.generatedImage.trim()
          : null,
      errorText:
        typeof parsed.errorText === "string" && parsed.errorText.trim()
          ? parsed.errorText.trim()
          : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function hasMeaningfulStoryboardGrid25Draft(draft: StoryboardGrid25Draft) {
  if (draft.plotText.trim()) return true;
  if (draft.generatedImage) return true;
  if (draft.errorText) return true;
  if (draft.refs.length > 1) return true;

  return draft.refs.some((ref, index) => {
    if (ref.url) return true;
    return ref.name !== defaultName(index);
  });
}

function writeStoryboardGrid25Draft(storageKey: string, draft: StoryboardGrid25Draft) {
  if (typeof window === "undefined") return;

  try {
    if (!hasMeaningfulStoryboardGrid25Draft(draft)) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Ignore storage failures so editing and generation still work normally.
  }
}

/** Returns the @-query the user is currently typing, or null if cursor isn't inside one. */
function getAtQuery(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  const match = before.match(/@([\u4e00-\u9fa5\w]*)$/);
  return match ? match[1] : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StoryboardGrid25() {
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const storageKey = getStoryboardGrid25DraftKey(actorId, currentProjectId);

  // Named reference images
  const [refs, setRefs] = useState<RefEntry[]>(() => buildDefaultRefs());

  // Asset picker: which ref slot is targeting the picker
  const [assetPickerFor, setAssetPickerFor] = useState<string | null>(null);
  // Per-slot file input refs
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Plot text + @ autocomplete
  const [plotText, setPlotText] = useState("");
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  // Lightbox / download
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const lastGeneratedImageRef = useRef<string | null>(null);

  useEffect(() => {
    return () => { if (progressTimerRef.current) window.clearInterval(progressTimerRef.current); };
  }, []);

  useEffect(() => {
    const draft = readStoryboardGrid25Draft(storageKey);
    const restoredRefs = normalizeDraftRefs(draft?.refs);
    const restoredGeneratedImage = draft?.generatedImage ?? null;

    setRefs(restoredRefs);
    setPlotText(draft?.plotText ?? "");
    setGeneratedImage(restoredGeneratedImage);
    setErrorText(draft?.errorText ?? null);
    setStatusText("");
    setProgress(0);
    setIsGenerating(false);
    setAtQuery(null);
    setCursorPos(0);
    setAssetPickerFor(null);
    setLightboxOpen(false);
    setDownloaded(false);
    lastGeneratedImageRef.current = restoredGeneratedImage;
    setLoadedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (generatedImage) {
      lastGeneratedImageRef.current = generatedImage;
    }
  }, [generatedImage]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;

    writeStoryboardGrid25Draft(storageKey, {
      version: 1,
      refs: refs.map(({ id, name, url }) => ({ id, name, url })),
      plotText,
      generatedImage: isGenerating ? (generatedImage || lastGeneratedImageRef.current) : generatedImage,
      errorText,
      updatedAt: Date.now(),
    });
  }, [errorText, generatedImage, isGenerating, loadedStorageKey, plotText, refs, storageKey]);

  // ── Reference management ──────────────────────────────────────────────────

  const addRef = () => {
    if (refs.length >= MAX_REFS) return;
    setRefs((prev) => [
      ...prev,
      { id: makeId(), name: defaultName(prev.length), url: null, isUploading: false },
    ]);
  };

  const removeRef = (id: string) => {
    setRefs((prev) => prev.filter((r) => r.id !== id));
    if (assetPickerFor === id) setAssetPickerFor(null);
  };

  const renameRef = (id: string, name: string) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
  };

  const setRefUrl = (id: string, url: string) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, url, isUploading: false } : r)));
  };

  const setRefUploading = (id: string, isUploading: boolean) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, isUploading } : r)));
  };

  const handleFileChange = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAssetPickerFor(null);
    setRefUploading(id, true);
    setErrorText(null);
    try {
      const uploaded = await uploadFile(file, "image");
      setRefUrl(id, uploaded.url);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "图片上传失败");
      setRefUploading(id, false);
    }
  };

  const handleAssetSelect = (id: string, asset: ReferenceAssetSelection) => {
    setRefUrl(id, asset.url);
    setAssetPickerFor(null);
  };

  // ── Insert @mention into textarea ─────────────────────────────────────────

  const insertAtMention = useCallback((name: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? cursorPos;
    const before = plotText.slice(0, pos);
    const after = plotText.slice(pos);
    // Replace the partial @query already typed
    const atStart = before.lastIndexOf("@");
    const newText = before.slice(0, atStart) + `@${name}` + after;
    setPlotText(newText);
    setAtQuery(null);
    // Restore cursor position after the inserted mention
    const newCursor = atStart + name.length + 1;
    requestAnimationFrame(() => {
      ta.setSelectionRange(newCursor, newCursor);
      ta.focus();
    });
  }, [plotText, cursorPos]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = e.target;
    setPlotText(value);
    const pos = selectionStart ?? value.length;
    setCursorPos(pos);
    setAtQuery(getAtQuery(value, pos));
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Close autocomplete on Escape
    if (e.key === "Escape" && atQuery !== null) {
      setAtQuery(null);
    }
  };

  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const pos = ta.selectionStart ?? 0;
    setCursorPos(pos);
    setAtQuery(getAtQuery(ta.value, pos));
  };

  // ── Autocomplete filtered list ────────────────────────────────────────────

  const atMatches = atQuery !== null
    ? refs.filter(
        (r) => r.url && r.name.toLowerCase().includes((atQuery ?? "").toLowerCase()),
      )
    : [];

  // ── Progress helpers ──────────────────────────────────────────────────────

  const startFakeProgress = () => {
    setProgress(1);
    setStatusText("正在分析剧情结构与角色特征...");
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        const next = prev + (prev < 40 ? 2 : prev < 70 ? 1 : 0.5);
        if (next >= 40 && prev < 40) setStatusText("正在生成 25 宫格分镜画面...");
        else if (next >= 70 && prev < 70) setStatusText("正在拼接画面并优化细节...");
        else if (next >= 90 && prev < 90) setStatusText("即将完成...");
        return Math.min(95, next);
      });
    }, 800);
  };

  const stopFakeProgress = () => {
    if (progressTimerRef.current) { window.clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
  };

  // ── Generate ─────────────────────────────────────────────────────────────

  const readyRefs: StoryboardGrid25Reference[] = refs
    .filter((r): r is RefEntry & { url: string } => Boolean(r.url))
    .map((r) => ({ name: r.name, url: r.url }));

  const canGenerate =
    plotText.trim().length > 0 &&
    readyRefs.length > 0 &&
    !isGenerating &&
    !refs.some((r) => r.isUploading);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setGeneratedImage(null);
    setErrorText(null);
    startFakeProgress();
    try {
      const result = await generateStoryboardGrid25(plotText, {
        references: readyRefs,
        model: GEMINI_MODEL_ID,
      });
      stopFakeProgress();
      setProgress(100);
      setStatusText(`生成完成（${result.model ?? GEMINI_MODEL_LABEL}）`);
      setGeneratedImage(result.imageUrl);
    } catch (err) {
      const parsed = parseGenerationError(err);
      stopFakeProgress();
      setProgress(0);
      setStatusText("");
      setErrorText(parsed.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Download ─────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!generatedImage) return;
    fetch(generatedImage)
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `storyboard-25grid-${Date.now()}.png`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); window.URL.revokeObjectURL(url);
        setDownloaded(true); setTimeout(() => setDownloaded(false), 2000);
      })
      .catch(() => {
        const a = document.createElement("a");
        a.href = generatedImage; a.download = `storyboard-25grid-${Date.now()}.png`;
        a.target = "_blank"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background px-4 py-3 text-foreground sm:px-5 sm:py-4">
      {/* Header */}
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-bold text-foreground sm:text-xl">合成工具箱：25宫格分镜</h1>
        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground sm:text-[10px]">
          25-GRID STORYBOARD GENERATOR
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
        {/* ── Left Column ── */}
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[min(26rem,100%)] lg:max-w-[26rem]">

          {/* ── Reference Images Card ── */}
          <div className="flex flex-col rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <ImageIcon className="h-4 w-4 text-primary" />
                参考图 &amp; @标签
              </h3>
              <span className="text-[11px] text-muted-foreground">{refs.length}/{MAX_REFS}</span>
            </div>

            {/* Hint */}
            <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <AtSign className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
              上传参考图并为每张命名。在剧情文本中输入 <span className="mx-0.5 rounded bg-primary/10 px-1 font-mono text-primary">@名称</span> 即可关联该角色或道具。
            </p>

            {/* Reference list */}
            <div className="flex flex-col gap-3">
              {refs.map((ref, idx) => (
                <RefCard
                  key={ref.id}
                  ref_={ref}
                  idx={idx}
                  currentProjectId={currentProjectId}
                  assetPickerOpen={assetPickerFor === ref.id}
                  onOpenAssetPicker={() =>
                    setAssetPickerFor((v) => (v === ref.id ? null : ref.id))
                  }
                  onCloseAssetPicker={() => setAssetPickerFor(null)}
                  onFileChange={(e) => void handleFileChange(ref.id, e)}
                  onAssetSelect={(asset) => handleAssetSelect(ref.id, asset)}
                  onRename={(name) => renameRef(ref.id, name)}
                  onRemove={() => removeRef(ref.id)}
                  onInsertMention={() => insertAtMention(ref.name)}
                  canRemove={refs.length > 1}
                  fileInputRef={(el) => { fileInputRefs.current[ref.id] = el; }}
                  onFileInputClick={() => fileInputRefs.current[ref.id]?.click()}
                />
              ))}
            </div>

            {/* Add reference button */}
            {refs.length < MAX_REFS && (
              <button
                onClick={addRef}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                添加参考图
              </button>
            )}
          </div>

          {/* ── Plot Text Card ── */}
          <div className="flex flex-1 flex-col rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <LayoutGrid className="h-4 w-4 text-primary" />
              剧情文本
            </h3>

            {/* Textarea + @ autocomplete */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={plotText}
                onChange={handleTextareaChange}
                onKeyDown={handleTextareaKeyDown}
                onSelect={handleTextareaSelect}
                onClick={handleTextareaSelect}
                placeholder={`输入一段连续剧情描述，输入 @ 可关联已命名的角色或道具参考图，例如：\n@${refs[0]?.name ?? "主角"} 缓缓走向山巅，夕阳将她的影子拉得很长...`}
                rows={9}
                className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />

              {/* @ Autocomplete dropdown */}
              {atQuery !== null && atMatches.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 z-30 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                    插入引用
                  </div>
                  {atMatches.map((r) => (
                    <button
                      key={r.id}
                      onMouseDown={(e) => { e.preventDefault(); insertAtMention(r.name); }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
                    >
                      <img
                        src={r.url!}
                        alt={r.name}
                        className="h-9 w-9 rounded-md border border-border object-cover"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground">@{r.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">点击插入到光标处</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* @ Hint: show when no refs are ready and user hasn't typed yet */}
              {readyRefs.length === 0 && (
                <div className="pointer-events-none absolute bottom-2.5 right-3 text-[10px] text-muted-foreground/40">
                  先上传参考图才能使用 @
                </div>
              )}
            </div>

            {/* Active mentions chips */}
            {readyRefs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {readyRefs.map((r) => {
                  const mentioned = plotText.includes(`@${r.name}`);
                  return (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() => insertAtMention(r.name)}
                      title={`插入 @${r.name}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        mentioned
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary",
                      )}
                    >
                      <img src={r.url} alt="" className="h-4 w-4 rounded-full object-cover" />
                      @{r.name}
                    </button>
                  );
                })}
              </div>
            )}

            {errorText && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
                {errorText}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleGenerate()}
                disabled={!canGenerate}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-primary-foreground transition-all",
                  !canGenerate
                    ? "cursor-not-allowed bg-primary/50"
                    : "bg-primary shadow-md shadow-primary/20 hover:bg-primary/90",
                )}
              >
                {isGenerating ? (
                  <><LoaderCircle className="h-4 w-4 animate-spin" />生成中...</>
                ) : (
                  <><Sparkles className="h-4 w-4" />生成 25 宫格分镜</>
                )}
              </button>

              {/* Model badge */}
              <div
                title={`使用 ${GEMINI_MODEL_LABEL} 生成 25 宫格分镜图`}
                className="flex h-12 shrink-0 items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3"
              >
                <Cpu className="h-4 w-4 text-blue-500" />
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-blue-500/70">Model</span>
                  <span className="text-[11px] font-semibold text-blue-500">{GEMINI_MODEL_LABEL}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Column (Output) ── */}
        <div className="flex min-h-[24rem] min-w-0 flex-1 flex-col rounded-xl border border-border bg-card p-4 sm:p-5 lg:min-h-0">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <LayoutGrid className="h-4 w-4 text-blue-500" />
              25 宫格生成结果
            </div>
            {generatedImage && (
              <div className="flex gap-2">
                <button
                  onClick={() => setLightboxOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent/80"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                  放大预览
                </button>
                <button
                  onClick={handleDownload}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
                    downloaded
                      ? "bg-green-500/15 text-green-700 dark:text-green-400"
                      : "bg-primary/10 text-primary hover:bg-primary/20",
                  )}
                >
                  {downloaded ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                  {downloaded ? "已下载" : "下载图片"}
                </button>
              </div>
            )}
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20">
            {generatedImage ? (
              <div className="h-full w-full p-2">
                <img
                  src={generatedImage}
                  alt="25-Grid Storyboard"
                  className="h-full w-full cursor-zoom-in object-contain"
                  onDoubleClick={() => setLightboxOpen(true)}
                />
              </div>
            ) : isGenerating ? (
              <div className="flex w-full max-w-md flex-col items-center justify-center px-8">
                <div className="mb-6 grid grid-cols-5 gap-1 opacity-40">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-8 w-8 animate-pulse rounded-sm bg-primary/20"
                      style={{ animationDelay: `${i * 0.05}s` }}
                    />
                  ))}
                </div>
                <div className="w-full">
                  <div className="mb-2 flex justify-between text-[11px] font-medium">
                    <span className="text-muted-foreground">生成进度</span>
                    <span className="text-primary">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-3 text-center text-xs text-muted-foreground">{statusText}</div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground/50">
                <div className="mb-4 grid grid-cols-5 gap-1.5 opacity-20">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <div key={i} className="h-6 w-6 rounded-sm bg-current" />
                  ))}
                </div>
                <p className="text-sm">在左侧上传参考图并输入剧情后开始生成</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && generatedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-background/50 p-2 text-foreground backdrop-blur hover:bg-background/80"
            onClick={() => setLightboxOpen(false)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={generatedImage}
            alt="Enlarged Storyboard"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── RefCard sub-component ─────────────────────────────────────────────────────

type RefCardProps = {
  ref_: RefEntry;
  idx: number;
  currentProjectId: string | null;
  assetPickerOpen: boolean;
  onOpenAssetPicker: () => void;
  onCloseAssetPicker: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAssetSelect: (asset: ReferenceAssetSelection) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onInsertMention: () => void;
  canRemove: boolean;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onFileInputClick: () => void;
};

function RefCard({
  ref_,
  idx,
  currentProjectId,
  assetPickerOpen,
  onOpenAssetPicker,
  onCloseAssetPicker,
  onFileChange,
  onAssetSelect,
  onRename,
  onRemove,
  onInsertMention,
  canRemove,
  fileInputRef,
  onFileInputClick,
}: RefCardProps) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 p-3">
        {/* Thumbnail */}
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/30">
          {ref_.url ? (
            <img src={ref_.url} alt={ref_.name} className="h-full w-full object-cover" />
          ) : ref_.isUploading ? (
            <div className="flex h-full w-full items-center justify-center">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
            </div>
          )}
          {/* Index badge */}
          <div className="absolute bottom-0.5 right-0.5 rounded bg-background/80 px-1 text-[9px] font-bold text-muted-foreground backdrop-blur">
            {idx + 1}
          </div>
        </div>

        {/* Name + actions */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Name field */}
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
            <span className="shrink-0 text-[13px] font-bold text-primary">@</span>
            <input
              type="text"
              value={ref_.name}
              onChange={(e) => onRename(e.target.value.replace(/\s+/g, "").replace(/^@+/, ""))}
              placeholder={`角色${idx + 1}`}
              maxLength={12}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </div>

          {/* Upload / asset / insert / delete buttons */}
          <div className="flex gap-1.5">
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={onFileChange} />
            <button
              onClick={onFileInputClick}
              disabled={ref_.isUploading}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-accent-foreground transition-colors hover:bg-accent/80 disabled:opacity-50"
              title="本地上传"
            >
              <Upload className="h-3 w-3" />
              上传
            </button>
            <button
              onClick={onOpenAssetPicker}
              disabled={!currentProjectId || ref_.isUploading}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                assetPickerOpen
                  ? "bg-primary/15 text-primary"
                  : "bg-accent text-accent-foreground hover:bg-accent/80",
                !currentProjectId && "pointer-events-none opacity-40",
              )}
              title={currentProjectId ? "从资产库选择" : "请先选择项目"}
            >
              <FolderOpen className="h-3 w-3" />
              资产库
            </button>
            {ref_.url && (
              <button
                onClick={onInsertMention}
                className="flex items-center justify-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                title={`插入 @${ref_.name} 到光标处`}
              >
                <AtSign className="h-3 w-3" />
                @插入
              </button>
            )}
            {canRemove && (
              <button
                onClick={onRemove}
                className="flex items-center justify-center rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="删除此参考图"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Asset Picker */}
      {assetPickerOpen && currentProjectId && (
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">选择图片资产</span>
            <button
              onClick={onCloseAssetPicker}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ReferenceAssetPicker
            projectId={currentProjectId}
            mediaKind="image"
            hint="点击图片即可加载"
            onSelect={onAssetSelect}
          />
        </div>
      )}
    </div>
  );
}
