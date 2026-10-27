import { readFile } from "node:fs/promises";
import { join } from "node:path";

const dir = join(process.cwd(), "node_modules/@fontsource/onest/files");

/** Шрифт Onest с кириллицей для картинок, которые рисует ImageResponse. */
export async function loadOgFonts() {
  const load = (subset: string, weight: 300 | 500) =>
    readFile(join(dir, `onest-${subset}-${weight}-normal.woff`)).then((data) => ({
      name: "Onest",
      data,
      weight,
      style: "normal" as const,
    }));

  return Promise.all([load("cyrillic", 300), load("latin", 300), load("cyrillic", 500), load("latin", 500)]);
}
