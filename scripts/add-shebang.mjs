#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/add-shebang.mjs <file>");
  process.exit(1);
}

const resolved = path.resolve(process.cwd(), target);
const raw = await fs.readFile(resolved, "utf8");
const shebang = "#!/usr/bin/env node\n";
const next = raw.startsWith(shebang) ? raw : `${shebang}${raw}`;
await fs.writeFile(resolved, next, "utf8");
