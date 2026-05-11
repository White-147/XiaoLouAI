import { describe, expect, it } from "vitest";
import { parseGenerationError } from "../../generation-error";
import { getTaskFailureReason } from "../../task-status";

const vertexFilteredMessage =
  "Vertex Veo operation completed without videos. Filtered count: 1. Reasons: Veo could not generate 1 videos based on the prompt provided. You will not be charged for this request. Try rephrasing the prompt. If you think this was an error, send feedback. Support codes: 42237218";

describe("generation error helpers", () => {
  it("explains Vertex Veo content filtering in Chinese while preserving provider details", () => {
    const parsed = parseGenerationError(new Error(vertexFilteredMessage));

    expect(parsed.category).toBe("provider_content_filtered");
    expect(parsed.message).toContain("Vertex Veo 内容安全过滤了本次请求");
    expect(parsed.message).toContain("Veo could not generate 1 videos");
    expect(parsed.message).not.toContain("[ERROR]");
  });

  it("normalizes task failure reasons from Vertex Veo filtered jobs", () => {
    const reason = getTaskFailureReason({
      status: "failed",
      outputSummary: vertexFilteredMessage,
      currentStage: "",
    });

    expect(reason).toContain("Vertex Veo 内容安全过滤了本次请求");
    expect(reason).toContain("Support codes: 42237218");
  });
});
