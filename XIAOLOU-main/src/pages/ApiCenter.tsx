import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  Link as LinkIcon,
  LoaderCircle,
  Mic,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Video,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getKnownActors, setCurrentActorId, useActorId } from "../lib/actor-session";
import {
  getApiCenterConfig,
  getCapabilities,
  saveApiCenterVendorApiKey,
  testApiCenterVendorConnection,
  updateApiCenterDefaults,
  updateApiVendorModel,
  type ApiCenterConfig,
  type ApiVendor,
  type ApiVendorModel,
  type NodeModelAssignment,
} from "../lib/api";
import { cn } from "../lib/utils";

type CapabilitiesState = Awaited<ReturnType<typeof getCapabilities>>;

type ModelOption = {
  id: string;
  name: string;
};

type ModelDomain = "text" | "vision" | "image" | "video" | "audio";

const PAGE = "flex-1 overflow-y-auto bg-background text-foreground custom-scrollbar";
const WRAPPER = "mx-auto min-h-full max-w-[1440px] px-4 pb-12 pt-5 sm:px-5 lg:px-6";
const PANEL =
  "rounded-[28px] border border-border bg-card p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-5 lg:p-6";
const CARD =
  "rounded-[24px] border border-border bg-card shadow-[0_0_0_1px_rgba(0,0,0,0.12)]";
const FIELD =
  "min-h-[46px] rounded-xl border border-input bg-background px-4 text-sm text-foreground outline-none transition-colors focus:border-indigo-400/45 focus:ring-2 focus:ring-indigo-400/15 disabled:cursor-not-allowed disabled:text-muted-foreground";
const API_CENTER_FALLBACK_ACTOR_ID = "user_demo_001";

const DOMAIN_ORDER: ModelDomain[] = ["text", "vision", "image", "video", "audio"];
const DOMAIN_LABELS: Record<ModelDomain, string> = {
  text: "文本",
  vision: "视觉理解",
  image: "图像",
  video: "视频",
  audio: "音频",
};
const DOMAIN_ICONS: Record<ModelDomain, LucideIcon> = {
  text: FileText,
  vision: Wand2,
  image: ImageIcon,
  video: Video,
  audio: Mic,
};

const DEFAULT_MODEL_META: Array<{
  key: keyof ApiCenterConfig["defaults"];
  label: string;
  description: string;
  domain: ModelDomain;
  icon: LucideIcon;
}> = [
  {
    key: "textModelId",
    label: "文本分析模型",
    description: "负责剧本理解、分镜拆解、文案改写和资产抽取。",
    domain: "text",
    icon: FileText,
  },
  {
    key: "visionModelId",
    label: "视觉理解模型",
    description: "负责画面理解、图像分析和视觉结构判断。",
    domain: "vision",
    icon: Wand2,
  },
  {
    key: "imageModelId",
    label: "图像生成模型",
    description: "负责分镜出图、换装编辑、局部重绘和静帧增强。",
    domain: "image",
    icon: ImageIcon,
  },
  {
    key: "videoModelId",
    label: "视频生成模型",
    description: "负责图生视频、首尾帧视频和镜头动态生成。",
    domain: "video",
    icon: Video,
  },
  {
    key: "audioModelId",
    label: "语音合成模型",
    description: "负责配音合成、音色驱动和声音链路默认调用。",
    domain: "audio",
    icon: Mic,
  },
];

function formatTimestamp(value?: string | null) {
  if (!value) return "未检测";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未检测";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildPriceLine(model: ApiVendorModel) {
  const input = model.inputPrice && model.inputPrice !== "-" ? model.inputPrice : "-";
  const output = model.outputPrice && model.outputPrice !== "-" ? model.outputPrice : "-";
  return `输入 ${input} / 输出 ${output}`;
}

function getVendorTabs(vendor: ApiVendor): ModelDomain[] {
  const supported = new Set(vendor.supportedDomains ?? []);
  return DOMAIN_ORDER.filter((domain) => supported.has(domain));
}

function buildModelOptions(models: ApiVendorModel[], domain: ModelDomain): ModelOption[] {
  return models
    .filter((model) => model.enabled && model.domain === domain)
    .map((model) => ({ id: model.id, name: model.name }));
}

function resolveModelName(modelLookup: Map<string, string>, modelId: string | null | undefined) {
  if (!modelId) return "系统链路";
  return modelLookup.get(modelId) ?? modelId;
}

function InfoChip({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
      <span className="text-muted-foreground/80">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function Notice({
  children,
  tone = "warning",
  className,
}: {
  children: ReactNode;
  tone?: "warning" | "info";
  className?: string;
}) {
  const styles =
    tone === "warning"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-50"
      : "border-sky-400/20 bg-sky-400/10 text-sky-50";

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm leading-6", styles, className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>{children}</div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-[18px] font-semibold text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PrimaryButton({
  children,
  loading = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-500/45 disabled:text-slate-900/60"
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-[#141920] px-4 text-sm text-white/85 transition-colors hover:bg-[#1a2028] disabled:cursor-not-allowed disabled:text-white/35"
    >
      {children}
    </button>
  );
}

function ModelSelectCard({
  label,
  description,
  icon: Icon,
  value,
  options,
  loading,
  onChange,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  value: string;
  options: ModelOption[];
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const safeValue = options.some((option) => option.id === value) ? value : "";

  return (
    <div className={cn(CARD, "p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/80">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-white">{label}</h3>
          <p className="mt-1 text-sm leading-6 text-white/45">{description}</p>
        </div>
      </div>

      <label className="relative mt-5 block">
        <select
          value={safeValue}
          disabled={loading || !options.length}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
          className={cn(FIELD, "w-full appearance-none pr-12")}
        >
          <option value="">{options.length ? "请选择默认模型" : "当前没有可选模型"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/40">
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </label>
    </div>
  );
}

function AssignmentPanel({
  title,
  description,
  items,
  modelLookup,
}: {
  title: string;
  description: string;
  items: NodeModelAssignment[];
  modelLookup: Map<string, string>;
}) {
  return (
    <div className={cn(CARD, "p-4 sm:p-5")}>
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-white">{title}</div>
        <div className="mt-1 text-sm text-white/45">{description}</div>
      </div>

      <div className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.nodeCode}
              className="rounded-2xl border border-white/8 bg-[#0d1014] px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{item.nodeName}</div>
                  <div className="mt-1 text-xs text-white/45">
                    主模型：{resolveModelName(modelLookup, item.primaryModelId)}
                  </div>
                  {item.fallbackModelIds?.length ? (
                    <div className="mt-1 text-xs text-white/35">
                      备用：{item.fallbackModelIds.map((id) => resolveModelName(modelLookup, id)).join(" / ")}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/55">
                  {item.nodeCode}
                </div>
              </div>
              {item.notes ? <p className="mt-3 text-xs leading-5 text-white/35">{item.notes}</p> : null}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#0d1014] px-4 py-8 text-center text-sm text-white/35">
            暂无映射配置
          </div>
        )}
      </div>
    </div>
  );
}

function VendorCard({
  vendor,
  activeTab,
  draftKey,
  revealKey,
  busyKey,
  defaultModelIds,
  lockedModelIds,
  onDraftChange,
  onToggleReveal,
  onTabChange,
  onSaveKey,
  onClearKey,
  onTestConnection,
  onToggleModel,
}: {
  vendor: ApiVendor;
  activeTab: ModelDomain;
  draftKey: string;
  revealKey: boolean;
  busyKey: string | null;
  defaultModelIds: Set<string>;
  lockedModelIds: Set<string>;
  onDraftChange: (value: string) => void;
  onToggleReveal: () => void;
  onTabChange: (domain: ModelDomain) => void;
  onSaveKey: () => void;
  onClearKey: () => void;
  onTestConnection: () => void;
  onToggleModel: (model: ApiVendorModel) => void;
}) {
  const tabs = getVendorTabs(vendor);
  const visibleModels = vendor.models.filter((model) => model.domain === activeTab);
  const enabledCount = visibleModels.filter((model) => model.enabled).length;
  const hasConfiguredKey = Boolean(vendor.apiKeyConfigured ?? vendor.connected);
  const keyBusy = busyKey === `api-key:${vendor.id}`;
  const testBusy = busyKey === `test:${vendor.id}`;

  return (
    <article className={cn(CARD, "p-4 sm:p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <GripVertical className="h-4 w-4 text-white/28" />
            <h3 className="text-[18px] font-semibold text-white">{vendor.name}</h3>
            <LinkIcon className="h-4 w-4 text-red-300/85" />
            <div
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                vendor.connected
                  ? "bg-indigo-400/15 text-indigo-100"
                  : hasConfiguredKey
                    ? "bg-amber-400/15 text-amber-100"
                    : "bg-white/8 text-white/60",
              )}
            >
              {vendor.connected ? "连接正常" : hasConfiguredKey ? "已保存密钥" : "未配置"}
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/45">
            真实 API Key 会写入服务端环境变量。保存后可立即执行连接测试，并直接影响后端运行时配置。
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0d1014] px-4 py-3 text-xs text-white/60">
          <div>区域：{vendor.region || "未指定"}</div>
          <div className="mt-1">最近检测：{formatTimestamp(vendor.lastCheckedAt)}</div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/8 bg-[#0d1014] p-4">
        <div className="mb-2 text-sm font-medium text-white">API Key</div>

        <div className="flex flex-col gap-3">
          <label className="relative block">
            <input
              type={revealKey ? "text" : "password"}
              value={draftKey}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={
                hasConfiguredKey
                  ? "当前已保存密钥。输入新值并保存即可覆盖。"
                  : "请输入厂商 API Key"
              }
              className={cn(FIELD, "w-full pr-12")}
            />
            <button
              type="button"
              onClick={onToggleReveal}
              className="absolute inset-y-0 right-3 inline-flex items-center text-white/40 transition-colors hover:text-white/75"
              aria-label={revealKey ? "隐藏 API Key" : "显示 API Key"}
            >
              {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </label>

          <div className="flex flex-wrap gap-2">
            <PrimaryButton loading={keyBusy} onClick={onSaveKey}>
              <Save className="h-4 w-4" />
              保存密钥
            </PrimaryButton>
            <PrimaryButton loading={testBusy} disabled={!hasConfiguredKey} onClick={onTestConnection}>
              <RefreshCw className="h-4 w-4" />
              测试连接
            </PrimaryButton>
            <SecondaryButton disabled={!hasConfiguredKey || keyBusy} onClick={onClearKey}>
              <Trash2 className="h-4 w-4" />
              清除
            </SecondaryButton>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-white/40">
          出于安全考虑，页面不会回显服务端已经保存的真实密钥内容。
        </p>
      </div>

      <div className="mt-5 rounded-xl bg-[#0d1014] p-1">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const Icon = DOMAIN_ICONS[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={cn(
                  "flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm transition-colors",
                  isActive ? "bg-[#161b21] text-white" : "text-white/45 hover:text-white/80",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {DOMAIN_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="text-sm text-white/75">{DOMAIN_LABELS[activeTab]}模型池</div>
        <div className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/55">
          已启用 {enabledCount} / {visibleModels.length}
        </div>
      </div>

      <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-2 custom-scrollbar">
        {visibleModels.length ? (
          visibleModels.map((model) => {
            const toggling = busyKey === `model:${vendor.id}:${model.id}`;
            const isDefault = defaultModelIds.has(model.id);
            const isLocked = lockedModelIds.has(model.id);

            return (
              <div
                key={model.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[#0d1014] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{model.name}</span>
                    {isDefault ? (
                      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-100">
                        默认
                      </span>
                    ) : null}
                    {isLocked && !isDefault ? (
                      <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-medium text-sky-100">
                        链路引用
                      </span>
                    ) : null}
                    <span className="text-[11px] text-white/38">{buildPriceLine(model)}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-white/30">{model.id}</div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isLocked ? "text-sky-100" : model.enabled ? "text-indigo-200" : "text-white/38",
                    )}
                  >
                    {isLocked ? "已锁定" : model.enabled ? "已启用" : "已停用"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleModel(model)}
                    disabled={toggling || isLocked}
                    aria-pressed={model.enabled}
                    aria-label={
                      isLocked
                        ? `${model.name} 已被默认链路引用，当前不可切换`
                        : `${model.enabled ? "停用" : "启用"} ${model.name}`
                    }
                    title={isLocked ? "该模型仍被默认链路或流程映射引用，暂时不能停用。" : undefined}
                    className={cn(
                      "relative h-7 w-12 shrink-0 rounded-full border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] disabled:cursor-not-allowed disabled:opacity-70",
                      model.enabled ? "bg-indigo-500" : "bg-white/12",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-[3px] h-5 w-5 rounded-full bg-white transition-transform",
                        model.enabled ? "translate-x-[24px]" : "translate-x-[3px]",
                      )}
                    />
                    {toggling ? <LoaderCircle className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-slate-900" /> : null}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-[#0d1014] px-4 py-8 text-center text-sm text-white/35">
            当前分类下暂无模型
          </div>
        )}
      </div>
    </article>
  );
}

export default function ApiCenter() {
  const actorId = useActorId();
  const [capabilities, setCapabilities] = useState<CapabilitiesState | null>(null);
  const [config, setConfig] = useState<ApiCenterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [activeTabs, setActiveTabs] = useState<Record<string, ModelDomain>>({});
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 2600);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    const [capabilitiesResult, configResult] = await Promise.allSettled([
      getCapabilities(),
      getApiCenterConfig(),
    ]);

    if (capabilitiesResult.status === "fulfilled") {
      setCapabilities(capabilitiesResult.value);
    } else {
      setCapabilities(null);
      setNotice("能力发现接口暂时不可用，但 API 中心配置仍可继续编辑。");
    }

    if (configResult.status === "fulfilled") {
      const nextConfig = configResult.value;
      setConfig(nextConfig);
      setActiveTabs((current) => {
        const nextTabs = { ...current };
        nextConfig.vendors.forEach((vendor) => {
          const firstTab = getVendorTabs(vendor)[0] ?? "text";
          nextTabs[vendor.id] = nextTabs[vendor.id] ?? firstTab;
        });
        return nextTabs;
      });
    } else {
      setConfig(null);
      setError(configResult.reason instanceof Error ? configResult.reason.message : "API 中心加载失败。");
    }

    setLoading(false);
  };

  useEffect(() => {
    if (actorId === "guest") {
      const rememberedActorId =
        getKnownActors().find((actor) => actor.id && actor.id !== "guest")?.id ?? null;
      const nextActorId = rememberedActorId || API_CENTER_FALLBACK_ACTOR_ID;
      if (nextActorId !== actorId) {
        showToast("已自动切换到可配置 API 的账号。");
        setCurrentActorId(nextActorId);
        return;
      }
    }
    void loadData();
  }, [actorId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const vendors = useMemo(() => config?.vendors ?? [], [config]);

  const allModels = useMemo(() => vendors.flatMap((vendor) => vendor.models ?? []), [vendors]);

  const modelLookup = useMemo(
    () => new Map(allModels.map((model) => [model.id, model.name] as const)),
    [allModels],
  );

  const defaultModelIds = useMemo(() => {
    const ids = new Set<string>();
    if (!config) return ids;
    Object.values(config.defaults).forEach((id) => {
      if (id) ids.add(id);
    });
    return ids;
  }, [config]);

  const lockedModelIds = useMemo(() => {
    const ids = new Set<string>();
    if (!config) return ids;

    Object.values(config.defaults).forEach((id) => {
      if (id) ids.add(id);
    });

    [...(config.nodeAssignments ?? []), ...(config.toolboxAssignments ?? [])].forEach((assignment) => {
      if (assignment.primaryModelId) ids.add(assignment.primaryModelId);
      assignment.fallbackModelIds?.forEach((id) => {
        if (id) ids.add(id);
      });
    });

    return ids;
  }, [config]);

  const modelOptions = useMemo(
    () => ({
      text: buildModelOptions(allModels, "text"),
      vision: buildModelOptions(allModels, "vision"),
      image: buildModelOptions(allModels, "image"),
      video: buildModelOptions(allModels, "video"),
      audio: buildModelOptions(allModels, "audio"),
    }),
    [allModels],
  );

  const strategyEntries = useMemo(() => Object.entries(config?.strategies ?? {}), [config]);

  const replaceVendor = (vendorId: string, nextVendor: ApiVendor) => {
    setConfig((current) =>
      current
        ? {
            ...current,
            vendors: current.vendors.map((vendor) => (vendor.id === vendorId ? nextVendor : vendor)),
          }
        : current,
    );
  };

  const handleDefaultChange = async (
    key: keyof ApiCenterConfig["defaults"],
    value: string,
    label: string,
  ) => {
    setBusyKey(`default:${key}`);
    setNotice(null);

    try {
      const nextDefaults = await updateApiCenterDefaults({ [key]: value });
      setConfig((current) => (current ? { ...current, defaults: nextDefaults } : current));
      showToast(`${label}已更新`);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "默认模型更新失败。");
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveApiKey = async (vendor: ApiVendor) => {
    const draft = (draftKeys[vendor.id] ?? "").trim();
    if (!draft) {
      showToast("请先输入有效的 API Key");
      return;
    }

    setBusyKey(`api-key:${vendor.id}`);
    setNotice(null);

    try {
      const nextVendor = await saveApiCenterVendorApiKey(vendor.id, draft);
      replaceVendor(vendor.id, nextVendor);
      setDraftKeys((current) => ({ ...current, [vendor.id]: "" }));
      showToast(`${vendor.name} 的 API Key 已保存`);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "保存 API Key 失败。");
    } finally {
      setBusyKey(null);
    }
  };

  const handleClearApiKey = async (vendor: ApiVendor) => {
    setBusyKey(`api-key:${vendor.id}`);
    setNotice(null);

    try {
      const nextVendor = await saveApiCenterVendorApiKey(vendor.id, "");
      replaceVendor(vendor.id, nextVendor);
      setDraftKeys((current) => ({ ...current, [vendor.id]: "" }));
      showToast(`${vendor.name} 的 API Key 已清除`);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "清除 API Key 失败。");
    } finally {
      setBusyKey(null);
    }
  };

  const handleTestConnection = async (vendor: ApiVendor) => {
    setBusyKey(`test:${vendor.id}`);
    setNotice(null);

    try {
      const result = await testApiCenterVendorConnection(vendor.id);
      replaceVendor(vendor.id, result.vendor);
      showToast(`${vendor.name} 连接正常，发现 ${result.modelCount} 个可用模型`);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "连接测试失败。");
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleModel = async (vendorId: string, model: ApiVendorModel) => {
    setBusyKey(`model:${vendorId}:${model.id}`);
    setNotice(null);

    try {
      const nextModel = await updateApiVendorModel(vendorId, model.id, { enabled: !model.enabled });
      setConfig((current) =>
        current
          ? {
              ...current,
              vendors: current.vendors.map((vendor) =>
                vendor.id === vendorId
                  ? {
                      ...vendor,
                      models: vendor.models.map((item) => (item.id === model.id ? nextModel : item)),
                    }
                  : vendor,
              ),
            }
          : current,
      );
      showToast(nextModel.enabled ? `${nextModel.name} 已启用` : `${nextModel.name} 已停用`);
    } catch (caughtError) {
      setNotice(caughtError instanceof Error ? caughtError.message : "模型状态更新失败。");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className={PAGE}>
      <div className={WRAPPER}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-white">API 配置</h1>
            <p className="mt-1 text-sm text-white/50">
              当前页面直接读取真实后端配置，页面里的模型状态、默认链路和连接结果都会立即影响运行时。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {capabilities ? (
              <>
                <InfoChip icon={ShieldCheck} label="服务" value={capabilities.service} />
                <InfoChip icon={LayoutGrid} label="模式" value={capabilities.mode} />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/10 bg-[#0d1014] px-4 text-sm text-white/85 transition-colors hover:bg-[#141920]"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新配置
            </button>
          </div>
        </div>

        {notice ? <Notice>{notice}</Notice> : null}

        {loading && !config ? (
          <section className={PANEL}>
            <div className="flex min-h-[240px] items-center justify-center gap-3 text-white/70">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              正在加载 API 中心配置...
            </div>
          </section>
        ) : null}

        {error ? (
          <section className={cn(PANEL, loading && !config ? "hidden" : "")}>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold text-white">
                  <AlertTriangle className="h-5 w-5 text-amber-300" />
                  API 中心暂时不可用
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-slate-950 transition-colors hover:bg-indigo-400"
              >
                <RefreshCw className="h-4 w-4" />
                重新加载
              </button>
            </div>
          </section>
        ) : null}

        {!error && config ? (
          <div className="space-y-5">
            <section className={PANEL}>
              <SectionHeader
                icon={ShieldCheck}
                title="真实运行时接入"
                description="当前已经接入真实后端配置。这里展示的是正在运行的厂商、模型池和默认链路，不再是本地假数据。"
                action={
                  capabilities ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <InfoChip
                        icon={LayoutGrid}
                        label="已实现域"
                        value={String(capabilities.implementedDomains.length)}
                      />
                      <InfoChip icon={Wand2} label="工具箱" value={String(capabilities.toolbox.length)} />
                    </div>
                  ) : undefined
                }
              />

              {!vendors.some((vendor) => vendor.apiKeyConfigured ?? vendor.connected) ? (
                <Notice className="mt-5">
                  还没有可用的 API Key。先在下方填入密钥并执行“测试连接”，通过后模型池与默认链路才会真正生效。
                </Notice>
              ) : null}

              {strategyEntries.length ? (
                <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {strategyEntries.map(([key, value]) => (
                    <div key={key} className="rounded-2xl border border-white/10 bg-[#0d1014] px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/40">{key}</div>
                      <div className="mt-3 text-sm leading-6 text-white/80">{value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className={PANEL}>
              <SectionHeader
                icon={Settings2}
                title="默认模型配置"
                description="这里修改的是后端真实默认模型。剧本、分镜、出图、视频、配音等链路会优先读取这里的配置。"
              />

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {DEFAULT_MODEL_META.map((item) => (
                  <ModelSelectCard
                    key={item.key}
                    label={item.label}
                    description={item.description}
                    icon={item.icon}
                    value={config.defaults[item.key]}
                    options={modelOptions[item.domain]}
                    loading={busyKey === `default:${item.key}`}
                    onChange={(value) => void handleDefaultChange(item.key, value, item.label)}
                  />
                ))}
              </div>
            </section>

            <section className={PANEL}>
              <SectionHeader
                icon={KeyRound}
                title="厂商资源池"
                description="下方显示当前真实可用的厂商与模型池。网页现在使用独立滚动容器，模型列表和启用开关不会再被页面裁掉。"
              />

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {vendors.map((vendor) => (
                  <VendorCard
                    key={vendor.id}
                    vendor={vendor}
                    activeTab={activeTabs[vendor.id] ?? getVendorTabs(vendor)[0] ?? "text"}
                    draftKey={draftKeys[vendor.id] ?? ""}
                    revealKey={Boolean(revealedKeys[vendor.id])}
                    busyKey={busyKey}
                    defaultModelIds={defaultModelIds}
                    lockedModelIds={lockedModelIds}
                    onDraftChange={(value) =>
                      setDraftKeys((current) => ({ ...current, [vendor.id]: value }))
                    }
                    onToggleReveal={() =>
                      setRevealedKeys((current) => ({ ...current, [vendor.id]: !current[vendor.id] }))
                    }
                    onTabChange={(domain) =>
                      setActiveTabs((current) => ({ ...current, [vendor.id]: domain }))
                    }
                    onSaveKey={() => void handleSaveApiKey(vendor)}
                    onClearKey={() => void handleClearApiKey(vendor)}
                    onTestConnection={() => void handleTestConnection(vendor)}
                    onToggleModel={(model) => void handleToggleModel(vendor.id, model)}
                  />
                ))}
              </div>
            </section>

            <section className={PANEL}>
              <SectionHeader
                icon={LayoutGrid}
                title="生产链路映射"
                description="这里展示后端正在使用的节点映射与工具箱能力，方便你核对每条链路当前会调用哪一个模型。"
              />

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <AssignmentPanel
                  title="七节点工作流"
                  description="全局设定、故事脚本、分镜、出图、视频与配音主链路"
                  items={config.nodeAssignments ?? []}
                  modelLookup={modelLookup}
                />
                <AssignmentPanel
                  title="工具箱能力"
                  description="人物替换、动作迁移、超清修复等扩展能力"
                  items={config.toolboxAssignments ?? []}
                  modelLookup={modelLookup}
                />
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-50">
          <div className="flex items-center gap-2 rounded-2xl border border-indigo-400/20 bg-[#10151a] px-4 py-3 text-sm text-white shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
            <CheckCircle2 className="h-4 w-4 text-indigo-400" />
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
