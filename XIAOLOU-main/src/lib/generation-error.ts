export type GenerationErrorCategory =
  | "web_balance_insufficient"
  | "provider_balance_insufficient"
  | "queue_timeout"
  | "provider_not_configured"
  | "input_invalid"
  | "unknown";

type ErrorLike = {
  message?: string;
  code?: string;
  status?: number;
};

function asErrorLike(error: unknown): ErrorLike {
  if (!error || typeof error !== "object") {
    return { message: error instanceof Error ? error.message : String(error ?? "") };
  }
  const e = error as Record<string, unknown>;
  return {
    message: typeof e.message === "string" ? e.message : "",
    code: typeof e.code === "string" ? e.code : "",
    status: typeof e.status === "number" ? e.status : undefined,
  };
}

function normalizeText(value: string) {
  return String(value || "").toLowerCase();
}

export function parseGenerationError(error: unknown): { category: GenerationErrorCategory; message: string } {
  const e = asErrorLike(error);
  const message = e.message || "生成失败，请稍后重试。";
  const code = String(e.code || "").toUpperCase();
  const text = normalizeText(message);

  if (code === "INSUFFICIENT_CREDITS" || code === "PROJECT_BUDGET_EXCEEDED") {
    return {
      category: "web_balance_insufficient",
      message: "网页账户余额不足或项目预算已用尽，请先充值或调整预算后重试。",
    };
  }

  if (code === "YUNWU_TASK_TIMEOUT" || code === "ALIYUN_TASK_TIMEOUT") {
    return {
      category: "queue_timeout",
      message: "当前排队或生成耗时过长，任务已超时。请稍后重试或降低并发。",
    };
  }

  if (code === "PROVIDER_NOT_CONFIGURED") {
    return {
      category: "provider_not_configured",
      message,
    };
  }

  if (
    code === "YUNWU_API_ERROR" ||
    code === "ALIYUN_API_ERROR" ||
    text.includes("insufficient quota") ||
    text.includes("insufficient balance") ||
    text.includes("quota exceeded") ||
    text.includes("余额不足") ||
    text.includes("额度不足")
  ) {
    return {
      category: "provider_balance_insufficient",
      message: "API 后台余额或额度不足，请充值对应模型服务后重试。",
    };
  }

  if (code === "BAD_REQUEST" || text.includes("bad request") || text.includes("参考图") || text.includes("参数")) {
    return {
      category: "input_invalid",
      message,
    };
  }

  if (text.includes("timed out") || text.includes("timeout") || text.includes("排队") || text.includes("队列")) {
    return {
      category: "queue_timeout",
      message: "当前排队或生成耗时过长，建议稍后重试。",
    };
  }

  return {
    category: "unknown",
    message,
  };
}
