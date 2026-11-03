import { appendFile, rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "docs");
await build({
  root: join(root, "static-game"),
  configFile: false,
  base: "./",
  publicDir: join(root, "public"),
  plugins: [
    react(),
    {
      name: "sea-gates-css-sources",
      enforce: "pre",
      transform(css, id) {
        if (id !== normalizePath(join(root, "app/globals.css"))) return;
        // Scan the game's UI, never previous production bundles or the private
        // site's unrelated component catalog. A second build must be identical.
        return css.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);') + `
@source "./sea-gates-game.tsx";
@source "../components/ui/dialog.tsx";
@source "../components/ui/button.tsx";`;
      },
    },
  ],
  resolve: { alias: { "@": root } },
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  build: { outDir: out, emptyOutDir: true, target: "es2020", license: { fileName: "third-party-licenses.md" } },
});
// Vite lists JavaScript modules. The generated CSS also incorporates these stylesheets.
for (const [name, path] of [
  ["Tailwind CSS", "node_modules/tailwindcss/LICENSE"],
  ["tw-animate-css", "node_modules/tw-animate-css/LICENSE"],
  ["shadcn stylesheet", "vendor/shadcn-tailwind-4.13.0.LICENSE.md"],
]) {
  const license = await readFile(join(root, path), "utf8");
  await appendFile(join(out, "third-party-licenses.md"), `\n## ${name}\n\n${license}\n`);
}
const manifest = JSON.parse(await readFile(join(out, "manifest.webmanifest"), "utf8"));
manifest.name = "The Sea Gates";
manifest.id = manifest.scope = manifest.start_url = "./";
for (const icon of manifest.icons) icon.src = "." + icon.src;
await writeFile(join(out, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(out, ".nojekyll"), "");
// These unused graphics belong to the private site's framework template.
for (const file of ["favicon.svg", "file.svg", "globe.svg", "window.svg"]) {
  await rm(join(out, file), { force: true });
}
