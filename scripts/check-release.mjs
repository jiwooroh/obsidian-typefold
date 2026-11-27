#!/usr/bin/env node
// Run before every release:  node scripts/check-release.mjs
// Fails (exit 1) when the repo would ship something that only works on the author's machine.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const problems = [];
const fail = (msg) => problems.push(msg);

// 1. The demo vault may only switch on plugins that are actually in the repo.
//    (community-plugins.json listing a plugin whose folder isn't shipped made
//    Typefold report it as enabled — issue #2.)
const tracked = execSync("git ls-files demo-vault/.obsidian/plugins", { cwd: root, encoding: "utf8" })
  .split("\n").filter(Boolean).map((p) => p.split("/")[3]);
const shipped = new Set(tracked);
const enabled = JSON.parse(read("demo-vault/.obsidian/community-plugins.json"));
for (const id of enabled) {
  if (!shipped.has(id)) fail(`demo-vault enables "${id}", but its plugin folder isn't in the repo. Remove it from demo-vault/.obsidian/community-plugins.json.`);
}

// 2. Bases in the demo vault must use core view types, so they open without companion plugins.
const CORE_VIEWS = new Set(["table", "cards", "list", "map"]);
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
  const p = join(dir, n);
  if (n.startsWith(".")) return [];
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
for (const file of walk("demo-vault").filter((p) => p.endsWith(".base"))) {
  for (const m of read(file).matchAll(/^\s*-\s*type:\s*([\w-]+)/gm)) {
    if (!CORE_VIEWS.has(m[1])) fail(`${file} uses the "${m[1]}" view, which needs a companion plugin. Use table / cards in the demo vault.`);
  }
}

// 3. Version bookkeeping.
const manifest = JSON.parse(read("manifest.json"));
const versions = JSON.parse(read("versions.json"));
if (!versions[manifest.version]) fail(`versions.json has no entry for ${manifest.version}.`);
if (versions[manifest.version] && versions[manifest.version] !== manifest.minAppVersion)
  fail(`versions.json says ${manifest.version} needs ${versions[manifest.version]}, manifest says ${manifest.minAppVersion}.`);

// 4. main.js parses, and developer-only defaults are off.
const main = read("main.js");
try { new vm.Script(main, { filename: "main.js" }); } catch (e) { fail(`main.js doesn't parse: ${e.message}`); }
if (!/devAutoReload:\s*false/.test(main)) fail("main.js: devAutoReload must default to false.");

// 5. Every image the README shows is in the repo.
for (const m of read("README.md").matchAll(/(?:!\[[^\]]*\]\(|src=")((?:docs|demo-vault)\/[^)"\s]+)/g)) {
  if (!existsSync(join(root, m[1]))) fail(`README links to ${m[1]}, which doesn't exist.`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n- ` + problems.join("\n- "));
  process.exit(1);
}
console.log(`✓ ready to release ${manifest.version}`);
