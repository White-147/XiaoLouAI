require("../src/env").loadEnvFiles();

const http = require("node:http");

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://root:root@127.0.0.1:5432/xiaolou";
process.env.VR_DATABASE_URL = process.env.VR_DATABASE_URL || process.env.DATABASE_URL;
process.env.JAAZ_DATABASE_URL = process.env.JAAZ_DATABASE_URL || process.env.DATABASE_URL;

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
          let body = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({ status: res.statusCode || 0, body, text });
        });
      },
    );

    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function bootServer() {
  const { createServer } = require("../src/server");
  const server = await createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
  if (server.store && typeof server.store.close === "function") {
    await server.store.close();
  }
}

async function main() {
  const boot = await bootServer();
  const actorId = "user_demo_001";
  const canvasId = `verify_pg_canvas_${Date.now()}`;
  let closed = false;

  try {
    const health = await request(boot.baseUrl, "/healthz");
    if (health.status !== 200 || health.body?.data?.mode !== "postgres") {
      throw new Error(`healthz postgres mode failed: ${health.text}`);
    }

    const projects = await request(boot.baseUrl, "/api/projects", {
      headers: { "X-Actor-Id": actorId },
    });
    if (projects.status !== 200) throw new Error(`projects failed: ${projects.text}`);

    const wallet = await request(boot.baseUrl, "/api/wallet", {
      headers: { "X-Actor-Id": actorId },
    });
    if (wallet.status !== 200) throw new Error(`wallet failed: ${wallet.text}`);

    const createdCanvas = await request(boot.baseUrl, "/api/canvas-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Actor-Id": actorId },
      body: JSON.stringify({
        id: canvasId,
        title: "PostgreSQL Verify Canvas",
        canvasData: { nodes: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } },
      }),
    });
    if (createdCanvas.status !== 201) {
      throw new Error(`canvas create failed: ${createdCanvas.text}`);
    }
    await boot.server.store.flushSnapshot();

    await closeServer(boot.server);
    closed = true;

    const { PostgresStore } = require("../src/postgres-store");
    const reloaded = await PostgresStore.create();
    try {
      const project = reloaded.getCanvasProject(actorId, canvasId);
      if (!project?.id) throw new Error("postgres canvas persistence failed");
      reloaded.deleteCanvasProject(actorId, canvasId);
      await reloaded.flushSnapshot();
    } finally {
      await reloaded.close();
    }

    console.log("verify postgres ok");
  } finally {
    if (!closed) {
      await closeServer(boot.server).catch(() => {});
    }
  }
}

main().catch((error) => {
  if (error?.code === "ECONNREFUSED") {
    console.error(
      "PostgreSQL is not reachable. Start PostgreSQL and ensure DATABASE_URL points to postgres://root:root@127.0.0.1:5432/xiaolou",
    );
  }
  if (String(error?.message || "").includes("PostgreSQL snapshot is empty")) {
    console.error("PostgreSQL is reachable but has no imported SQLite snapshot. Run npm run db:import-sqlite first.");
  }
  console.error(error);
  process.exit(1);
});
