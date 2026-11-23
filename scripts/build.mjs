import { copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependencies = join(root, "node_modules");
const output = join(root, "dist");
const vendor = join(output, "vendor");
await mkdir(join(vendor, "core"), { recursive: true });
await mkdir(join(vendor, "lang"), { recursive: true });
await mkdir(join(vendor, "licenses"), { recursive: true });
await cp(join(root, "src"), output, { recursive: true });
for (const name of [
  "tesseract.min.js",
  "worker.min.js",
  "tesseract.min.js.LICENSE.txt",
  "worker.min.js.LICENSE.txt",
]) {
  await copyFile(
    join(dependencies, "tesseract.js/dist", name),
    join(vendor, name),
  );
}
// OEM.LSTM_ONLY selects one of these self-contained loaders based on browser SIMD support.
const core = join(dependencies, "tesseract.js-core");
for (const name of await readdir(core)) {
  if (name.endsWith("-lstm.wasm.js"))
    await copyFile(join(core, name), join(vendor, "core", name));
}
await copyFile(
  join(
    dependencies,
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  ),
  join(vendor, "lang/eng.traineddata.gz"),
);
await copyFile(
  join(
    dependencies,
    "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  ),
  join(vendor, "dm-sans.woff2"),
);
for (const [pkg, label] of [
  ["tesseract.js", "tesseract"],
  ["tesseract.js-core", "tesseract-core"],
  ["@fontsource-variable/dm-sans", "dm-sans"],
]) {
  const license = (await readdir(join(dependencies, pkg))).find((name) =>
    /^(license|ofl)(\.|$)/i.test(name),
  );
  await copyFile(
    join(dependencies, pkg, license),
    join(vendor, "licenses", label + ".txt"),
  );
}
console.log("Built the static site in dist/ with local OCR assets.");
