export type GenerationErrorCategory =
  | "web_balance_insufficient"
  | "provider_balance_insufficient"
  | "provider_quota_exhausted"
  | "queue_timeout"
  | "provider_not_configured"
  | "input_invalid"
  | "unknown";

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
};

type EmbeddedApiError = {
  message: string;
  code: string;
  status?: number;
};

function asErrorLike(error: unknown): ErrorLike {
  if (!error || typeof error !== "object") {
    return { message: error instanceof Error ? error.message : String(error ?? "") };
  }

  const e = error as Record<string, unknown>;
  return {
    name: typeof e.name === "string" ? e.name : "",
    message: typeof e.message === "string" ? e.message : "",
    code: typeof e.code === "string" ? e.code : "",
    status: typeof e.status === "number" ? e.status : undefined,
  };
}

function normalizeText(value: string) {
  return String(value || "").toLowerCase();
}

function parseEmbeddedApiError(message: string): EmbeddedApiError | null {
  const trimmed = String(message || "").trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { code?: number | string; status?: string; statusCode?: number; message?: string };
    };
    const embedded = parsed?.error;
    if (!embedded || typeof embedded !== "object") return null;

    const embeddedMessage =
      typeof embedded.message === "string" && embedded.message.trim()
        ? embedded.message.trim()
        : trimmed;
    const embeddedCode =
      typeof embedded.status === "string" && embedded.status.trim()
        ? embedded.status.trim()
        : typeof embedded.code === "string" && embedded.code.trim()
          ? embedded.code.trim()
          : "";
    const embeddedStatus =
      typeof embedded.statusCode === "number"
        ? embedded.statusCode
        : typeof embedded.code === "number"
          ? embedded.code
          : undefined;

    return {
      message: embeddedMessage,
      code: embeddedCode,
      status: embeddedStatus,
    };
  } catch {
    return null;
  }
}

/**
 * Categorise a generation error for UI styling while preserving the concrete
 * provider reason. We may append a short hint, but we should not hide the raw
 * failure details from the user.
 */
export function parseGenerationError(error: unknown): {
  category: GenerationErrorCategory;
  code: string;
  message: string;
  detail: string;
} {
  const e = asErrorLike(error);
  const embedded = parseEmbeddedApiError(e.message || "");
  const rawMessage =
    embedded?.message ||
    (e.message || "").trim() ||
    "\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002";
  const code = String(embedded?.code || e.code || e.name || "").toUpperCase();
  const status = embedded?.status ?? e.status;
  const text = normalizeText(rawMessage);

  let category: GenerationErrorCategory = "unknown";
  let hint: string | null = null;

  if (code === "INSUFFICIENT_CREDITS") {
    category = "web_balance_insufficient";
    hint = "\u7f51\u9875\u8d26\u6237\u4f59\u989d\u4e0d\u8db3\uff0c\u8bf7\u5148\u5145\u503c\u540e\u91cd\u8bd5\u3002";
  } else if (
    code === "RESOURCE_EXHAUSTED" ||
    status === 429 ||
    text.includes("resource has been exhausted") ||
    text.includes("check quota") ||
    text.includes("quota exceeded") ||
    text.includes("insufficient quota") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    category = "provider_quota_exhausted";
    hint =
      "\u5f53\u524d Gemini / Vertex \u914d\u989d\u6216\u8c03\u7528\u901f\u7387\u9650\u5236\u5df2\u89e6\u53d1\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\uff1b\u82e5\u6301\u7eed\u51fa\u73b0\uff0c\u8bf7\u68c0\u67e5 Google Cloud / Vertex \u9879\u76ee quota\u3002";
  } else if (
    code === "YUNWU_TASK_TIMEOUT" ||
    code === "ALIYUN_TASK_TIMEOUT" ||
    text.includes("timed out") ||
    text.includes("timeout")
  ) {
    category = "queue_timeout";
    hint =
      "\u6392\u961f\u6216\u751f\u6210\u8017\u65f6\u8fc7\u957f\uff0c\u4efb\u52a1\u5df2\u8d85\u65f6\uff0c\u53ef\u7a0d\u540e\u91cd\u8bd5\u6216\u964d\u4f4e\u5e76\u53d1\u3002";
  } else if (code === "PROVIDER_NOT_CONFIGURED") {
    category = "provider_not_configured";
  } else if (
    code === "YUNWU_API_ERROR" ||
    code === "ALIYUN_API_ERROR" ||
    text.includes("insufficient balance") ||
    text.includes("accountoverdueerror")
  ) {
    category = "provider_balance_insufficient";
    hint =
      "\u540e\u7aef API \u8d26\u6237\u4f59\u989d\u4e0d\u8db3\u6216\u8d26\u6237\u5df2\u6b20\u8d39\uff0c\u8bf7\u5148\u4e3a\u5bf9\u5e94\u6a21\u578b\u670d\u52a1\u5145\u503c\u540e\u91cd\u8bd5\u3002";
  } else if (
    code === "BAD_REQUEST" ||
    text.includes("bad request") ||
    text.includes("reference image") ||
    text.includes("parameter")
  ) {
    category = "input_invalid";
  }

  const codeTag = code ? `[${code}] ` : "";
  const message = hint
    ? `${codeTag}${hint}\n\u8be6\u60c5\uff1a${rawMessage}`
    : `${codeTag}${rawMessage}`;

  return { category, code, message, detail: rawMessage };
}
