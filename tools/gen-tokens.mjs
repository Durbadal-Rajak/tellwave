// Generates public/css/tokens.css from replica/design/tokens.json.
// Run: node tools/gen-tokens.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const t = JSON.parse(readFileSync(join(root, "replica/design/tokens.json"), "utf8"));

const colorVars = (c) => Object.entries(c).map(([k, v]) => `  --${k}: ${v};`).join("\n");
const type = Object.entries(t.type)
  .map(([k, v]) => `  --fs-${k}: ${v.size}px;\n  --lh-${k}: ${v.line}px;\n  --fw-${k}: ${v.weight};`).join("\n");
const space = t.space.map((v, i) => `  --space-${i}: ${v}px;`).join("\n");
const radius = Object.entries(t.radius).map(([k, v]) => `  --radius-${k}: ${v}px;`).join("\n");
const shadow = Object.entries(t.shadow).map(([k, v]) => `  --shadow-${k}: ${v};`).join("\n");
const motion = Object.entries(t.motion).map(([k, v]) => `  --motion-${k}: ${v};`).join("\n");
const layout = Object.entries(t.layout).map(([k, v]) => `  --layout-${k}: ${v}px;`).join("\n");

const css = `/* Generated from replica/design/tokens.json by tools/gen-tokens.mjs. Do not edit by hand. */
:root {
  color-scheme: light;
  --font-display: ${t.font.display};
  --font-body: ${t.font.body};
${type}
${space}
${radius}
${shadow}
${motion}
${layout}
${colorVars(t.color.light)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${colorVars(t.color.dark).replace(/^/gm, "  ")}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${colorVars(t.color.dark)}
}
`;
writeFileSync(join(root, "public/css/tokens.css"), css);
console.log("wrote public/css/tokens.css");
