const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DIRS = [
  path.join(ROOT, "data", "canvas-library", "workflows"),
];

// Migration map for one-shot normalization of stored workflow JSON files.
// gpt-image-1.5: old workflow data migration target — NOT a selectable model.
// Run `npm run normalize:canvas-workflows` to rewrite any stale files.
const LEGACY_MODEL_ALIASES = new Map([
  ["gpt-image-1.5", "gemini-3-pro-image-preview"],  // old workflow data migration — not a selectable model
]);

const shouldWrite = process.argv.includes("--write");

function normalizeModelId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return { value, changed: false };
  const next = LEGACY_MODEL_ALIASES.get(normalized) || normalized;
  return { value: next, changed: next !== value };
}

function visitNode(node) {
  if (!node || typeof node !== "object") return { node, changed: false, replacements: 0 };

  let changed = false;
  let replacements = 0;
  const nextNode = { ...node };

  for (const field of ["imageModel", "model"]) {
    if (typeof nextNode[field] !== "string") continue;
    const result = normalizeModelId(nextNode[field]);
    if (result.changed) {
      nextNode[field] = result.value;
      changed = true;
      replacements += 1;
    }
  }

  return { node: nextNode, changed, replacements };
}

function normalizeWorkflowFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.nodes)) {
    return { changed: false, replacements: 0 };
  }

  let changed = false;
  let replacements = 0;
  const nextNodes = parsed.nodes.map((node) => {
    const result = visitNode(node);
    changed ||= result.changed;
    replacements += result.replacements;
    return result.node;
  });

  if (!changed) {
    return { changed: false, replacements: 0 };
  }

  const nextWorkflow = { ...parsed, nodes: nextNodes };
  if (shouldWrite) {
    fs.writeFileSync(filePath, `${JSON.stringify(nextWorkflow, null, 2)}\n`);
  }

  return { changed: true, replacements };
}

function main() {
  let changedFiles = 0;
  let replacements = 0;

  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const result = normalizeWorkflowFile(filePath);
      if (!result.changed) continue;
      changedFiles += 1;
      replacements += result.replacements;
      console.log(`${shouldWrite ? "updated" : "would update"} ${path.relative(ROOT, filePath)} (${result.replacements} replacements)`);
    }
  }

  console.log(
    `${shouldWrite ? "normalized" : "dry-run complete"}: ${changedFiles} files, ${replacements} replacements`,
  );
}

main();
