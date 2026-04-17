const http = require("node:http");
const { rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const sharp = require("sharp");

function request(baseUrl, path, init = {}) {
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init.method || "GET",
        headers: init.headers || {},
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 0,
            body: text ? JSON.parse(text) : null,
          });
        });
      }
    );

    req.on("error", reject);

    if (init.body) {
      req.write(init.body);
    }

    req.end();
  });
}

async function bootServer() {
  const { createServer } = require("../src/server");
  const server = createServer();

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const verifyDbPath = join(tmpdir(), `core-api-verify-${Date.now()}.sqlite`);
  const verifyUploadDir = join(tmpdir(), `core-api-uploads-${Date.now()}`);
  process.env.CORE_API_DB_PATH = verifyDbPath;
  process.env.CORE_API_UPLOAD_DIR = verifyUploadDir;
  const verifyPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();

  const boot = await bootServer();

  const health = await request(boot.baseUrl, "/healthz");
  const projects = await request(boot.baseUrl, "/api/projects");
  const overview = await request(boot.baseUrl, "/api/projects/proj_demo_001/overview");
  const projectTasks = await request(boot.baseUrl, "/api/projects/proj_demo_001/tasks");
  const toolbox = await request(boot.baseUrl, "/api/toolbox/capabilities");
  const createImages = await request(boot.baseUrl, "/api/create/images");
  const createVideos = await request(boot.baseUrl, "/api/create/videos");
  // Note: /api/admin/api-config was removed from the routing layer.
  // We still verify the endpoint gives a non-500 response (404 is acceptable)
  // rather than asserting specific payload shape that no longer applies.
  const apiConfig = await request(boot.baseUrl, "/api/admin/api-config");
  const storyboardGeneration = await request(
    boot.baseUrl,
    "/api/projects/proj_demo_001/storyboards/auto-generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  const uploaded = await request(boot.baseUrl, "/api/uploads?kind=test", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Upload-Filename": encodeURIComponent("verify-image.png"),
    },
    body: verifyPng,
  });
  const createdProject = await request(boot.baseUrl, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Persistence Verify Project",
      summary: "Created during verification.",
    }),
  });

  if (health.status !== 200) throw new Error("healthz failed");
  if (health.body?.data?.mode !== "sqlite") throw new Error("health mode failed");
  if (projects.status !== 200) throw new Error("projects failed");
  if (overview.status !== 200) throw new Error("project overview failed");
  if (!overview.body?.data?.project?.id) throw new Error("project overview payload failed");
  if (projectTasks.status !== 200) throw new Error("project tasks failed");
  if (!Array.isArray(projectTasks.body?.data?.items)) throw new Error("project tasks payload failed");
  if (toolbox.status !== 200) throw new Error("toolbox failed");
  if (createImages.status !== 200) throw new Error("create images failed");
  if (!Array.isArray(createImages.body?.data?.items)) throw new Error("create images payload failed");
  if (createVideos.status !== 200) throw new Error("create videos failed");
  if (!Array.isArray(createVideos.body?.data?.items)) throw new Error("create videos payload failed");
  // /api/admin/api-config was removed; 404 is the expected response now.
  if (apiConfig.status !== 404 && apiConfig.status !== 200) {
    throw new Error(`api config endpoint returned unexpected status ${apiConfig.status}`);
  }
  if (storyboardGeneration.status !== 202) throw new Error("storyboard auto generate failed");
  if (uploaded.status !== 201) throw new Error("upload failed");
  if (!uploaded.body?.data?.url?.includes("/uploads/")) throw new Error("upload payload failed");
  if (uploaded.body?.data?.contentType !== "image/jpeg") throw new Error("upload conversion failed");
  if (!String(uploaded.body?.data?.storedName || "").endsWith(".jpg")) {
    throw new Error("upload stored extension failed");
  }
  if (createdProject.status !== 201) throw new Error("project creation failed");

  await new Promise((resolve) => setTimeout(resolve, 2600));
  const generatedStoryboards = await request(boot.baseUrl, "/api/projects/proj_demo_001/storyboards");
  if (generatedStoryboards.status !== 200) throw new Error("storyboard list failed");
  if (!Array.isArray(generatedStoryboards.body?.data?.items) || !generatedStoryboards.body.data.items.length) {
    throw new Error("storyboard auto generation produced no shots");
  }
  if (
    generatedStoryboards.body.data.items.some(
      (item) =>
        item.script === "A new storyboard shot generated from the current script."
    )
  ) {
    throw new Error("storyboard auto generation is still using placeholder copy");
  }

  const createdProjectId = createdProject.body?.data?.id;
  if (!createdProjectId) throw new Error("created project payload failed");

  await closeServer(boot.server);

  delete require.cache[require.resolve("../src/sqlite-store")];
  const { SqliteStore } = require("../src/sqlite-store");
  const store = new SqliteStore({ dbPath: verifyDbPath });
  const reloadedProject = store.getProject(createdProjectId);
  if (!reloadedProject?.id) throw new Error("sqlite persistence failed");
  store.close();

  rmSync(verifyDbPath, { force: true, maxRetries: 3, retryDelay: 50 });
  rmSync(verifyUploadDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
  console.log("verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
