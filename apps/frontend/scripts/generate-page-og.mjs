#!/usr/bin/env node
// Share cards (1200×630) for the pages with their own: each docs chapter and the battle calculator. They're drawn
// on the site's card (assets/og-image.jpg) with the page's title and a piece of game art, and written to
// public/assets/og/<page>-v1.jpg, which the pages name in their head (setPageHead). /assets/ is cached forever,
// so a recut needs a new version in both places. Text uses the machine's sans-serif fonts; commit the output.
// Usage: node scripts/generate-page-og.mjs
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const VERSION = "v1";
const assets = new URL("../public/assets/", import.meta.url).pathname;
const art = (path) => `${assets}game/style-pass/generated/${path}.webp`;
const docsArt = {
  beginner: "ships/colony-ship",
  concepts: "planets/crystal-violet",
  catalogs: "ships/battlecruiser",
  formulas: "research/plasma",
  mechanics: "buildings/interdimensional-rift-stabilizer-mid",
  contracts: "ships/deathstar",
};
// The chapters' titles and descriptions come from the docs' own definitions.
const docs = [...readFileSync(new URL("../src/docs/docsSource.ts", import.meta.url), "utf8")
  .matchAll(/slug: "(\w+)",\s*title: "([^"]+)",\s*eyebrow: "([^"]+)",\s*description: "([^"]+)"/g)]
  .map(([, slug, title, eyebrow, description]) => ({ file: `docs-${slug}`, eyebrow: `Veydrift docs · ${eyebrow}`, title, description, art: docsArt[slug] }));
const pages = [
  ...docs,
  { file: "calculator", eyebrow: "Veydrift", title: "Battle calculator", art: "ships/light-fighter",
    description: "Set both fleets and defenses, or load a planet by its coordinates, and see how the fight ends." },
];
if (docs.length !== Object.keys(docsArt).length || pages.some((page) => !page.art)) throw new Error("every docs chapter needs its art here");

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrap(text, width) {
  const lines = [];
  for (const word of text.split(" ")) {
    if (lines.length && `${lines.at(-1)} ${word}`.length <= width) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

const font = "Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
// The art is drawn on a gray backdrop; a radial fade blends it into the card instead of pasting a square.
const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="440"><defs><radialGradient id="f">
  <stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <rect width="440" height="440" fill="url(#f)"/></svg>`);
// The site card, blurred so its own wordmark doesn't show through the page's title.
const background = await sharp(`${assets}og-image.jpg`).resize(1200, 630).blur(16).toBuffer();
mkdirSync(`${assets}og`, { recursive: true });
for (const page of pages) {
  const title = wrap(page.title, 14);
  const description = wrap(page.description, 40).slice(0, 3);
  // The eyebrow, title and description are centred on the card as one block.
  const top = Math.round((630 - (46 + title.length * 88 + description.length * 42)) / 2);
  const titleY = top + 46 + 66;
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs><linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#060b16" stop-opacity="0.9"/><stop offset="0.6" stop-color="#060b16" stop-opacity="0.6"/><stop offset="1" stop-color="#060b16" stop-opacity="0.2"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#shade)"/>
    <text x="72" y="${top + 24}" fill="#7dd3fc" font-family="${font}" font-size="24" font-weight="600" letter-spacing="4">${escape(page.eyebrow.toUpperCase())}</text>
    ${title.map((line, i) => `<text x="72" y="${titleY + i * 88}" fill="#ffffff" font-family="${font}" font-size="80" font-weight="700">${escape(line)}</text>`).join("")}
    ${description.map((line, i) => `<text x="72" y="${titleY + (title.length - 1) * 88 + 58 + i * 42}" fill="#cbd5e1" font-family="${font}" font-size="30">${escape(line)}</text>`).join("")}
    <text x="72" y="590" fill="#94a3b8" font-family="${font}" font-size="22" font-weight="600" letter-spacing="6">VEYDRIFT.COM</text>
  </svg>`;
  const picture = await sharp(art(page.art)).resize(440, 440).composite([{ input: fade, blend: "dest-in" }]).png().toBuffer();
  const out = `${assets}og/${page.file}-${VERSION}.jpg`;
  await sharp(background)
    .composite([{ input: Buffer.from(text), top: 0, left: 0 }, { input: picture, top: 95, left: 730 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  console.log(out);
}
