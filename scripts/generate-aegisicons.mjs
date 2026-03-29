#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const iconsDir = path.join(projectRoot, "public", "assets", "icons");
const outputFile = path.join(projectRoot, "public", "assets", "css", "aegisicons.css");

function toKebab(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

async function collectSvgFiles(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSvgFiles(full, acc);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
      acc.push(full);
    }
  }
  return acc;
}

function encodedIconUrl(relativePath) {
  const asPosix = relativePath.split(path.sep).join("/");
  return `../icons/${encodeURI(asPosix)}`;
}

async function main() {
  const iconFiles = await collectSvgFiles(iconsDir);

  const usedNames = new Set();
  const mappings = [];

  for (const iconFile of iconFiles.sort()) {
    const relativePath = path.relative(iconsDir, iconFile);
    const parsed = path.parse(relativePath);
    const baseName = toKebab(parsed.name);

    let className = baseName;
    if (usedNames.has(className)) {
      const folderHint = toKebab(path.basename(parsed.dir || "icons"));
      className = `${folderHint}-${baseName}`;
    }

    let suffix = 2;
    while (usedNames.has(className)) {
      className = `${baseName}-${suffix}`;
      suffix += 1;
    }

    usedNames.add(className);
    mappings.push({ className, iconUrl: encodedIconUrl(relativePath) });
  }

  const lines = [];
  lines.push("/*");
  lines.push(" * AegisIcons (auto-generated)");
  lines.push(" * Source: public/assets/icons/**/*.svg");
  lines.push(" * Command: node scripts/generate-aegisicons.mjs");
  lines.push(" */");
  lines.push("");
  lines.push('[class^="ag-"],');
  lines.push('[class*=" ag-"] {');
  lines.push("  display: inline-block;");
  lines.push("  width: 1em;");
  lines.push("  height: 1em;");
  lines.push("  background-color: currentColor;");
  lines.push("  -webkit-mask-repeat: no-repeat;");
  lines.push("  mask-repeat: no-repeat;");
  lines.push("  -webkit-mask-position: center;");
  lines.push("  mask-position: center;");
  lines.push("  -webkit-mask-size: contain;");
  lines.push("  mask-size: contain;");
  lines.push("  vertical-align: -0.12em;");
  lines.push("}");
  lines.push("");

  for (const item of mappings) {
    lines.push(`.ag-${item.className} {`);
    lines.push(`  -webkit-mask-image: url("${item.iconUrl}");`);
    lines.push(`  mask-image: url("${item.iconUrl}");`);
    lines.push("}");
    lines.push("");
  }

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, lines.join("\n"), "utf8");

  console.log(`Generated ${mappings.length} icon classes -> ${outputFile}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
