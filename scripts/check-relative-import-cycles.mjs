import { readFile } from "node:fs/promises";
import path from "node:path";

const extensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json"];
const entryArg = process.argv[2];
if (!entryArg) {
  console.error("Usage: node scripts/check-relative-import-cycles.mjs <entry-file>");
  process.exit(2);
}
const root = process.cwd();
const entry = path.resolve(root, entryArg);
const graph = new Map();

async function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => path.join(base, "index" + ext))];
  for (const candidate of candidates) {
    try {
      const stat = await import("node:fs/promises").then(fs => fs.stat(candidate));
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function collect(file) {
  if (graph.has(file)) return;
  const source = await readFile(file, "utf8");
  const imports = new Set();
  const patterns = [
    /\\b(?:import|export)\\s+(?:[^"'()]*?\\s+from\\s+)?["']([^"']+)["']/g,
    /\\bimport\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g,
    /\\brequire\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) imports.add(match[1]);
  const dependencies = [];
  for (const specifier of imports) {
    const resolved = await resolveLocalImport(file, specifier);
    if (resolved) dependencies.push(resolved);
  }
  graph.set(file, dependencies);
  for (const dependency of dependencies) await collect(dependency);
}

await collect(entry);
const visiting = new Set(), visited = new Set(), stack = [], cycles = [];
function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    cycles.push([...stack.slice(start), file].map(item => path.relative(root, item)));
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file); stack.push(file);
  for (const dependency of graph.get(file) || []) visit(dependency);
  stack.pop(); visiting.delete(file); visited.add(file);
}
visit(entry);
if (cycles.length) {
  console.error("Circular imports detected in the Controlled Document Upload dependency graph:");
  for (const cycle of cycles) console.error(" - " + cycle.join(" -> "));
  process.exit(1);
}
console.log("PASS: no relative-import cycles in " + path.relative(root, entry) + " (" + graph.size + " modules checked).");
