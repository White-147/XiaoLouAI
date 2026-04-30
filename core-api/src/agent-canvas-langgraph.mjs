import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const MAX_ACTIONS = 50;
const MEDIA_ACTION_TYPES = new Set(["generate_image", "generate_video"]);

const AgentCanvasState = Annotation.Root({
  request: Annotation({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  canvas: Annotation({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  plan: Annotation({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  response: Annotation({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  topic: Annotation({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  actions: Annotation({
    reducer: (left, right) => [...(left || []), ...(right || [])].slice(0, MAX_ACTIONS),
    default: () => [],
  }),
  warnings: Annotation({
    reducer: (left, right) => [...(left || []), ...(right || [])].slice(0, 30),
    default: () => [],
  }),
  provider: Annotation({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  model: Annotation({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  fallbackFrom: Annotation({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  groundingSources: Annotation({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  steps: Annotation({
    reducer: (left, right) => [...(left || []), ...(right || [])],
    default: () => [],
  }),
});

function emitStatus(emit, phase, title, detail, status = "active") {
  if (typeof emit !== "function") return;
  emit("status", {
    phase,
    title,
    detail,
    status,
    timestamp: new Date().toISOString(),
  });
}

function emitDelta(emit, agent, text, kind = "reasoning") {
  if (typeof emit !== "function" || !text) return;
  for (const chunk of Array.from(String(text))) {
    emit("delta", {
      kind,
      text: chunk,
      provider: "langgraph",
      model: agent,
      timestamp: new Date().toISOString(),
    });
  }
}

function emitActions(emit, agent, actions, detail) {
  if (typeof emit !== "function" || !Array.isArray(actions) || actions.length === 0) return;
  emit("actions", {
    agent,
    actions,
    detail,
    timestamp: new Date().toISOString(),
  });
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;
  try {
    return JSON.parse(candidate);
  } catch {}

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function actionType(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return "";
  return String(action.type || action.action || action.kind || "").trim().toLowerCase();
}

function actionTitle(action) {
  if (!action || typeof action !== "object") return "";
  return String(action.title || action.name || action.label || action.prompt || "").trim().slice(0, 80);
}

function coerceActions(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...item }))
    .slice(0, MAX_ACTIONS);
}

function coerceWarnings(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 20) : [];
}

function hasVisualIntent(text) {
  const value = String(text || "").toLowerCase();
  return /image|picture|poster|visual|photo|illustration|render|video|animate|motion|clip|镜头|画面|图片|图像|海报|视觉|视频|动画|生成图|生图/.test(value);
}

function hasVideoIntent(text) {
  const value = String(text || "").toLowerCase();
  return /video|animate|motion|clip|镜头|视频|动画|运镜|短片/.test(value);
}

function looksLikeCanvasIntent(text) {
  const value = String(text || "").toLowerCase();
  return /node|canvas|layout|group|connect|update|delete|move|storyboard|节点|画布|整理|分组|连接|创建|更新|删除|移动|脚本|分镜/.test(value);
}

function buildRequestSummary(request) {
  const canvas = request.canvas || {};
  return {
    message: request.message,
    instruction: request.instruction,
    sessionId: request.sessionId || null,
    canvas,
    attachments: request.attachments || [],
    webSearch: request.webSearch || null,
    tools: request.tools || {},
    agentOptions: request.agentOptions || {},
    skill: request.skill || {},
  };
}

function summarizeActions(actions) {
  const counts = new Map();
  for (const action of actions || []) {
    const type = actionType(action) || "unknown";
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([type, count]) => `${type} x${count}`).join(", ");
}

function createToolRegistry(emit) {
  return {
    async readCanvas(canvas) {
      const nodeCount = Array.isArray(canvas?.nodes) ? canvas.nodes.length : 0;
      const selectedCount = Array.isArray(canvas?.selectedNodeIds) ? canvas.selectedNodeIds.length : 0;
      emitDelta(
        emit,
        "ReadCanvasAgent",
        `读取画布上下文：当前有 ${nodeCount} 个节点，选中 ${selectedCount} 个节点。准备把画布摘要交给 PlannerAgent。\n`,
      );
      emitStatus(emit, "THINKING", "LangGraph read_canvas", `nodes: ${nodeCount}`, "done");
      return canvas || {};
    },
    async dispatchActions(agent, actions) {
      const normalized = coerceActions(actions);
      if (normalized.length === 0) return [];
      emitStatus(emit, "USING_TOOLS", `${agent} tool dispatch`, summarizeActions(normalized), "done");
      emitActions(emit, agent, normalized, summarizeActions(normalized));
      return normalized;
    },
  };
}

function createAbortError() {
  const error = new Error("Agent canvas request aborted");
  error.name = "AbortError";
  error.code = "AGENT_REQUEST_ABORTED";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function requestJsonCompletion(helpers, messages, options) {
  throwIfAborted(helpers.signal);
  const completion = await helpers.requestCompletion(messages, options);
  throwIfAborted(helpers.signal);
  const parsed = parseJsonObject(completion?.text);
  return { completion, parsed };
}

function buildPlannerPrompt() {
  return [
    "You are PlannerAgent in XiaoLou Agent Canvas LangGraph runtime.",
    "Your job is to split the user task into agent steps. Do not create final canvas actions.",
    "Return ONLY JSON: {\"response\":\"short Chinese user-facing summary\",\"topic\":\"short topic\",\"route\":{\"needsMedia\":boolean,\"needsCanvas\":boolean,\"needsSave\":boolean},\"plan\":[{\"agent\":\"planner|media_creator|canvas_writer\",\"goal\":\"...\"}],\"warnings\":[]}.",
    "Default every user-facing string to Simplified Chinese.",
    "Use media_creator for image or video generation. Use canvas_writer for nodes, layout, groups, connects, saves, and non-media canvas edits.",
  ].join("\n");
}

function buildMediaCreatorPrompt() {
  return [
    "You are MediaCreatorAgent in XiaoLou Agent Canvas LangGraph runtime.",
    "Produce only media generation canvas tool actions. Return ONLY JSON: {\"response\":\"short Chinese text\",\"actions\":[],\"warnings\":[]}.",
    "Allowed action types here: generate_image, generate_video.",
    "Use fields like {\"type\":\"generate_image\",\"title\":\"...\",\"prompt\":\"...\",\"x\":0,\"y\":0,\"imageModel\":\"...\",\"aspectRatio\":\"16:9\"}.",
    "For standalone visual creation, do not include parentIds/referenceNodeIds and do not connect to selected nodes.",
    "Only use referenceNodeIds, parentIds, image-to-video, start/end frame, edit, extend, or motion-control fields when the user explicitly asks to use an existing/selected/current/reference node or attachment.",
    "Respect agentOptions preferredImageToolId/preferredVideoToolId/allowed model ids when choosing model fields.",
    "If the request is not about image/video/audio media creation, return actions: [].",
  ].join("\n");
}

function buildCanvasWriterPrompt() {
  return [
    "You are CanvasWriterAgent in XiaoLou Agent Canvas LangGraph runtime.",
    "Produce canvas write actions that organize or edit the XiaoLou smart canvas. Return ONLY JSON: {\"response\":\"short Chinese text\",\"actions\":[],\"warnings\":[]}.",
    "Allowed action types: create_node, update_node, delete_nodes, connect_nodes, move_nodes, layout_nodes, group_nodes, save_canvas.",
    "Use existing node types only: Text, Image, Video, Audio, Image Editor, Video Editor, Storyboard Manager, Camera Angle, Local Image Model, Local Video Model.",
    "If MediaCreatorAgent already produced generate_image/generate_video actions, do not duplicate generation; only add layout/group/save actions if useful.",
    "For create_node use {\"type\":\"create_node\",\"nodeType\":\"Text\",\"title\":\"...\",\"content\":\"...\",\"x\":0,\"y\":0}.",
    "Never assume selected or nearby media is a reference unless the user explicitly says to use/reference/continue/edit/connect it.",
    "Default every user-facing field to Simplified Chinese.",
  ].join("\n");
}

function fallbackPlan(request) {
  const text = `${request.message || ""}\n${request.instruction || ""}`;
  const needsMedia = hasVisualIntent(text);
  return {
    response: "我会拆成计划、媒体生成和画布写入几个步骤来处理。",
    topic: String(request.message || "Agent Canvas").slice(0, 60),
    route: {
      needsMedia,
      needsCanvas: needsMedia || looksLikeCanvasIntent(text),
      needsSave: /save|保存/.test(text),
    },
    plan: [
      { agent: "planner", goal: "Understand the request and canvas context." },
      ...(needsMedia ? [{ agent: "media_creator", goal: "Create media generation actions." }] : []),
      { agent: "canvas_writer", goal: "Write actions back to the canvas." },
    ],
    warnings: ["PLANNER_RETURNED_UNSTRUCTURED_TEXT"],
  };
}

function buildFallbackMediaAction(request) {
  const text = String(request.message || "").trim();
  if (!hasVisualIntent(text)) return [];
  const isVideo = hasVideoIntent(text);
  return [
    {
      type: isVideo ? "generate_video" : "generate_image",
      title: isVideo ? "Agent video" : "Agent image",
      prompt: text || (isVideo ? "Create a short cinematic video." : "Create a high quality image."),
    },
  ];
}

function filterMediaActions(actions) {
  return coerceActions(actions).filter((action) => MEDIA_ACTION_TYPES.has(actionType(action)));
}

function filterCanvasActions(actions) {
  return coerceActions(actions).filter((action) => !MEDIA_ACTION_TYPES.has(actionType(action)));
}

function pickCompletionPatch(completion) {
  return {
    provider: completion?.provider,
    model: completion?.model,
    fallbackFrom: completion?.fallbackFrom,
    groundingSources: completion?.groundingSources,
  };
}

export async function runAgentCanvasLangGraph(input, helpers = {}) {
  if (typeof helpers.requestCompletion !== "function") {
    throw new Error("LangGraph runtime requires helpers.requestCompletion.");
  }

  const emit = typeof helpers.emit === "function" ? helpers.emit : undefined;
  const signal = helpers.signal;
  const tools = createToolRegistry(emit);

  const graph = new StateGraph(AgentCanvasState)
    .addNode("read_canvas", async (state) => {
      throwIfAborted(signal);
      const canvas = await tools.readCanvas(state.request.canvas);
      throwIfAborted(signal);
      return {
        canvas,
        steps: [{ agent: "read_canvas", status: "done" }],
      };
    })
    .addNode("planner", async (state) => {
      throwIfAborted(signal);
      const request = state.request;
      emitStatus(emit, "THINKING", "PlannerAgent planning", "Splitting task into agent steps", "active");
      emitDelta(
        emit,
        "PlannerAgent",
        [
          "PlannerAgent 开始规划：先读取用户目标和画布摘要。\n",
          `用户目标：${String(request.message || "").slice(0, 120) || "继续处理当前画布"}\n`,
          `画布节点：${Array.isArray(state.canvas?.nodes) ? state.canvas.nodes.length : 0}，附件：${Array.isArray(request.attachments) ? request.attachments.length : 0}。\n`,
          "接下来判断是否需要媒体生成、画布写入、保存动作，并输出 route 与 agent plan。\n",
        ].join(""),
      );
      const { completion, parsed } = await requestJsonCompletion(
        helpers,
        [
          { role: "system", content: buildPlannerPrompt() },
          { role: "user", content: JSON.stringify(buildRequestSummary(request)) },
        ],
        { maxTokens: Math.min(3000, request.maxTokens || 4096) },
      );

      const plan = parsed && typeof parsed === "object" ? parsed : fallbackPlan(request);
      emitDelta(
        emit,
        "PlannerAgent",
        `PlannerAgent 完成规划：${Array.isArray(plan.plan) ? `拆出 ${plan.plan.length} 个步骤` : "已生成默认计划"}，下一步交给 MediaCreatorAgent / CanvasWriterAgent。\n`,
      );
      emitStatus(emit, "THINKING", "PlannerAgent done", Array.isArray(plan.plan) ? `${plan.plan.length} steps` : "planned", "done");
      return {
        plan,
        response: String(plan.response || ""),
        topic: typeof plan.topic === "string" ? plan.topic.slice(0, 80) : undefined,
        warnings: coerceWarnings(plan.warnings),
        steps: [{ agent: "planner", status: "done", plan: plan.plan || [] }],
        ...pickCompletionPatch(completion),
      };
    })
    .addNode("media_creator", async (state) => {
      throwIfAborted(signal);
      const request = state.request;
      const plan = state.plan || {};
      const text = `${request.message || ""}\n${request.instruction || ""}`;
      const needsMedia = plan?.route?.needsMedia === true || hasVisualIntent(text);
      emitDelta(
        emit,
        "MediaCreatorAgent",
        `MediaCreatorAgent 检查媒体需求：${needsMedia ? "需要生成图片或视频工具动作" : "当前任务不需要媒体生成"}。\n`,
      );
      if (!needsMedia) {
        emitStatus(emit, "THINKING", "MediaCreatorAgent skipped", "No media generation needed", "done");
        return { steps: [{ agent: "media_creator", status: "skipped" }] };
      }

      emitStatus(emit, "THINKING", "MediaCreatorAgent working", "Preparing media tool actions", "active");
      emitDelta(
        emit,
        "MediaCreatorAgent",
        "MediaCreatorAgent 正在把用户需求转换成 generate_image / generate_video 工具动作 JSON，并检查是否真的需要引用画布节点。\n",
      );
      const { completion, parsed } = await requestJsonCompletion(
        helpers,
        [
          { role: "system", content: buildMediaCreatorPrompt() },
          {
            role: "user",
            content: JSON.stringify({
              request: buildRequestSummary(request),
              plan,
              canvas: state.canvas,
            }),
          },
        ],
        { maxTokens: Math.min(3500, request.maxTokens || 4096) },
      );
      throwIfAborted(signal);

      let actions = filterMediaActions(parsed?.actions);
      const warnings = coerceWarnings(parsed?.warnings);
      if (actions.length === 0) {
        actions = buildFallbackMediaAction(request);
        if (actions.length > 0) warnings.push("MEDIA_CREATOR_USED_FALLBACK_ACTION");
      }
      actions = await tools.dispatchActions("MediaCreatorAgent", actions);
      emitDelta(
        emit,
        "MediaCreatorAgent",
        `MediaCreatorAgent 完成：${actions.length > 0 ? summarizeActions(actions) : "没有生成媒体动作"}。\n`,
      );
      emitStatus(emit, "THINKING", "MediaCreatorAgent done", summarizeActions(actions) || "no media actions", "done");
      return {
        actions,
        warnings,
        response: String(parsed?.response || state.response || ""),
        steps: [{ agent: "media_creator", status: "done", actionCount: actions.length }],
        ...pickCompletionPatch(completion),
      };
    })
    .addNode("canvas_writer", async (state) => {
      throwIfAborted(signal);
      const request = state.request;
      const plan = state.plan || {};
      const text = `${request.message || ""}\n${request.instruction || ""}`;
      const needsCanvas =
        plan?.route?.needsCanvas === true ||
        plan?.route?.needsSave === true ||
        looksLikeCanvasIntent(text) ||
        (Array.isArray(state.actions) && state.actions.length > 0);
      emitDelta(
        emit,
        "CanvasWriterAgent",
        `CanvasWriterAgent 检查画布写入需求：${needsCanvas ? "需要写回画布动作" : "当前没有额外画布写入需求"}。\n`,
      );

      if (!needsCanvas) {
        emitStatus(emit, "THINKING", "CanvasWriterAgent skipped", "No canvas write needed", "done");
        return { steps: [{ agent: "canvas_writer", status: "skipped" }] };
      }

      emitStatus(emit, "THINKING", "CanvasWriterAgent working", "Preparing canvas write actions", "active");
      emitDelta(
        emit,
        "CanvasWriterAgent",
        "CanvasWriterAgent 正在整理节点创建、更新、布局、分组或保存动作，避免重复生成媒体动作。\n",
      );
      const { completion, parsed } = await requestJsonCompletion(
        helpers,
        [
          { role: "system", content: buildCanvasWriterPrompt() },
          {
            role: "user",
            content: JSON.stringify({
              request: buildRequestSummary(request),
              plan,
              canvas: state.canvas,
              existingActions: state.actions || [],
            }),
          },
        ],
        { maxTokens: Math.min(4000, request.maxTokens || 4096) },
      );
      throwIfAborted(signal);

      const actions = await tools.dispatchActions("CanvasWriterAgent", filterCanvasActions(parsed?.actions));
      emitDelta(
        emit,
        "CanvasWriterAgent",
        `CanvasWriterAgent 完成：${actions.length > 0 ? summarizeActions(actions) : "没有额外画布动作"}。\n`,
      );
      emitStatus(emit, "THINKING", "CanvasWriterAgent done", summarizeActions(actions) || "no canvas actions", "done");
      return {
        actions,
        warnings: coerceWarnings(parsed?.warnings),
        response: String(parsed?.response || state.response || ""),
        steps: [{ agent: "canvas_writer", status: "done", actionCount: actions.length }],
        ...pickCompletionPatch(completion),
      };
    })
    .addNode("finalizer", async (state) => {
      throwIfAborted(signal);
      const actions = coerceActions(state.actions).slice(0, MAX_ACTIONS);
      emitDelta(
        emit,
        "FinalizerAgent",
        `FinalizerAgent 汇总结果：准备返回 ${actions.length} 个动作，并结束本次 Agent 过程。\n`,
      );
      emitStatus(emit, "DONE", "LangGraph runtime complete", summarizeActions(actions) || "no canvas actions", "done");
      return {
        response: state.response || (actions.length > 0 ? "已完成多智能体规划，并把结果写回画布。" : "我已经完成分析，没有需要写入画布的动作。"),
        actions: [],
        steps: [{ agent: "finalizer", status: "done", actionCount: actions.length }],
      };
    })
    .addEdge(START, "read_canvas")
    .addEdge("read_canvas", "planner")
    .addEdge("planner", "media_creator")
    .addEdge("media_creator", "canvas_writer")
    .addEdge("canvas_writer", "finalizer")
    .addEdge("finalizer", END)
    .compile();

  emitStatus(emit, "THINKING", "LangGraph runtime started", "Preparing PlannerAgent", "done");
  throwIfAborted(signal);
  const finalState = await graph.invoke({
    request: {
      ...input,
      canvas: input.canvas || {},
      attachments: Array.isArray(input.attachments) ? input.attachments : [],
      tools: input.tools || {},
      agentOptions: input.agentOptions || {},
      maxTokens: input.maxTokens || 4096,
    },
  });
  throwIfAborted(signal);

  const actions = coerceActions(finalState.actions).slice(0, MAX_ACTIONS);
  return {
    sessionId: input.sessionId || null,
    response: String(finalState.response || "已完成。"),
    actions,
    warnings: coerceWarnings([...(input.toolWarnings || []), ...(finalState.warnings || [])]),
    topic: finalState.topic,
    provider: finalState.provider,
    model: finalState.model,
    fallbackFrom: finalState.fallbackFrom,
    groundingSources: finalState.groundingSources || input.webSearch?.sources,
    tools: input.tools || {},
    runtime: {
      type: "langgraphjs",
      agents: ["PlannerAgent", "MediaCreatorAgent", "CanvasWriterAgent"],
      steps: finalState.steps || [],
    },
  };
}
