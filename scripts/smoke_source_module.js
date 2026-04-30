// Asserts the new sourceModule field on /api/projects/:id/assets works end to end.
//
// 1. Creates 4 assets (image_create / video_create / canvas / video_replace)
// 2. Lists assets and verifies each persists its sourceModule
// 3. Removes them to keep the demo clean

const base = "http://127.0.0.1:4100";
const projectId = "proj_demo_001";

async function post(path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j));
  return j.data;
}

async function get(path) {
  const r = await fetch(base + path);
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j));
  return j.data;
}

async function del(path) {
  const r = await fetch(base + path, { method: "DELETE" });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j));
  return j.data;
}

(async () => {
  const samples = [
    { sourceModule: "image_create", mediaKind: "image", assetType: "scene", name: "SMOKE-image", url: "/uploads/smoke-1.jpg" },
    { sourceModule: "video_create", mediaKind: "video", assetType: "video_ref", name: "SMOKE-video-create", url: "/uploads/smoke-2.mp4" },
    { sourceModule: "canvas", mediaKind: "video", assetType: "video_ref", name: "SMOKE-canvas-video", url: "/uploads/smoke-3.mp4" },
    { sourceModule: "video_replace", mediaKind: "video", assetType: "video_ref", name: "SMOKE-video-replace", url: "/uploads/smoke-4.mp4" },
  ];
  const created = [];
  for (const s of samples) {
    const asset = await post(`/api/projects/${projectId}/assets`, {
      assetType: s.assetType,
      name: s.name,
      description: "smoke test for sourceModule",
      mediaKind: s.mediaKind,
      mediaUrl: s.url,
      previewUrl: s.url,
      sourceModule: s.sourceModule,
      scope: "manual",
    });
    created.push({ id: asset.id, expected: s });
    console.log(
      `created ${asset.id}  assetType=${asset.assetType}  mediaKind=${asset.mediaKind}  sourceModule=${asset.sourceModule}`,
    );
  }

  const { items } = await get(`/api/projects/${projectId}/assets`);
  const mine = items.filter((a) => created.some((c) => c.id === a.id));
  for (const a of mine) {
    const expected = created.find((c) => c.id === a.id).expected;
    if (a.sourceModule !== expected.sourceModule) {
      throw new Error(`mismatch on ${a.id}: got ${a.sourceModule}, expected ${expected.sourceModule}`);
    }
  }
  console.log(`\nAll ${mine.length} assets persisted sourceModule correctly.`);

  for (const c of created) {
    await del(`/api/projects/${projectId}/assets/${c.id}`);
  }
  console.log("cleanup OK");
})();
