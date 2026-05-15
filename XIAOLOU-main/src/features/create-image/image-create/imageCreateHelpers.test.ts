import { describe, expect, it } from "vitest";
import {
  buildImageAssetDraft,
  mergeReferenceImages,
  validateCreateImageReferenceFile,
  type ReferenceImageState,
} from "./imageCreateHelpers";
import type { CreateImageResult } from "./api/create-image";

function referenceImage(
  id: string,
  overrides: Partial<ReferenceImageState> = {},
): ReferenceImageState {
  return {
    id,
    url: `https://cdn.example.test/${id}.jpg`,
    originalName: `${id}.jpg`,
    source: "upload",
    ...overrides,
  };
}

function createResult(overrides: Partial<CreateImageResult> = {}): CreateImageResult {
  return {
    id: "image-result-1",
    taskId: "task-1",
    prompt: "A quiet neon street after rain",
    model: "doubao-seedream-5-0-260128",
    style: "电影感",
    aspectRatio: "16:9",
    resolution: "2K",
    imageUrl: "/media/generated/image-result-1.png",
    referenceImageUrl: "/media/reference/ref-1.png",
    referenceImageUrls: ["/media/reference/ref-1.png"],
    createdAt: "2026-05-14T08:00:00.000Z",
    ...overrides,
  };
}

describe("imageCreateHelpers", () => {
  it("merges reference images by recency, removing duplicate urls and asset ids", () => {
    const merged = mergeReferenceImages(
      [
        referenceImage("a"),
        referenceImage("b", { assetId: "asset-b", source: "asset" }),
        referenceImage("c"),
      ],
      [
        referenceImage("replacement-b", {
          assetId: "asset-b",
          source: "asset",
          url: "https://cdn.example.test/replacement-b.jpg",
        }),
        referenceImage("c"),
        referenceImage("d"),
        referenceImage("e"),
      ],
    );

    expect(merged.map((item) => item.id)).toEqual(["replacement-b", "c", "d", "e"]);
  });

  it("builds the image asset draft without changing source metadata", () => {
    const draft = buildImageAssetDraft(createResult());

    expect(draft).toMatchObject({
      id: "image-result-1",
      mediaKind: "image",
      mediaUrl: "/media/generated/image-result-1.png",
      previewUrl: "/media/generated/image-result-1.png",
      prompt: "A quiet neon street after rain",
      model: "doubao-seedream-5-0-260128",
      aspectRatio: "16:9",
      taskId: "task-1",
      referenceImageUrl: "/media/reference/ref-1.png",
      defaultAssetType: "style",
      sourceModule: "image_create",
    });
    expect(draft.defaultDescription).toContain("来源：图片创作");
    expect(draft.defaultDescription).toContain("清晰度：2K");
  });

  it("rejects GIF references with the existing validation message", async () => {
    const gif = new File(
      [Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
      "animated.gif",
      { type: "image/gif" },
    );

    await expect(validateCreateImageReferenceFile(gif)).resolves.toContain("是 GIF 格式");
  });
});
