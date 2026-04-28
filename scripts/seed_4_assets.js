const base = "http://127.0.0.1:4100";
const pid = "proj_demo_001";

async function post(body) {
  const r = await fetch(`${base}/api/projects/${pid}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j));
  return j.data;
}

const sampleImg = "https://ultralytics.com/images/bus.jpg";
const sampleVideo = "https://file-examples.com/storage/fe52cb0c4862dc676a1b5a2/2017/04/file_example_MP4_480_1_5MG.mp4";

(async () => {
  const items = [
    { assetType: "scene", name: "DEMO-图片创作", mediaKind: "image", mediaUrl: sampleImg, previewUrl: sampleImg, sourceModule: "image_create" },
    { assetType: "video_ref", name: "DEMO-视频创作", mediaKind: "video", mediaUrl: sampleVideo, previewUrl: sampleImg, sourceModule: "video_create" },
    { assetType: "video_ref", name: "DEMO-画布视频", mediaKind: "video", mediaUrl: sampleVideo + "?c=1", previewUrl: sampleImg, sourceModule: "canvas" },
    { assetType: "video_ref", name: "DEMO-人物替换", mediaKind: "video", mediaUrl: sampleVideo + "?c=2", previewUrl: sampleImg, sourceModule: "video_replace" },
  ];
  for (const it of items) {
    const a = await post({ ...it, description: "seed for UI check", scope: "manual" });
    console.log(`  ${a.id}  ${a.sourceModule}  ${a.name}`);
  }
})();
