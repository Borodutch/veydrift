import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mediaManifest, syncMedia } from "../scripts/media.mjs";
import { frontendResponse, responseHeadersFor } from "../scripts/serve.mjs";

const landingSource = new URL("../src/ComingSoonApp.tsx", import.meta.url);
const playerSource = new URL("../src/components/TrailerPlayer.tsx", import.meta.url);
const pactSource = new URL("../src/components/PactPage.tsx", import.meta.url);
const landingAsset = (name: string) => new URL(`../public/assets/landing/${name}`, import.meta.url);
const trailerFiles = ["veydrift-trailer-v1.mp4", "veydrift-trailer-v1-poster.webp", "veydrift-trailer-v1.vtt"];

describe("landing trailer", () => {
  test("places the trailer right under the claim hero", async () => {
    const source = await Bun.file(landingSource).text();
    const main = source.slice(source.indexOf('<main className="landing-page'));
    const body = main.slice(main.indexOf(">") + 1, main.indexOf("</main>"));
    const sections = [...body.matchAll(/<(\w+)[\s/]/g)].map((match) => match[1]);
    expect(sections.slice(0, 3)).toEqual(["HeroSection", "LandingTrailer", "ScreenshotsSection"]);
    expect(source).toContain('<TrailerPlayer />');
  });

  test("ships the referenced poster and captions, and pins the video as external media", async () => {
    const source = await Bun.file(playerSource).text();
    for (const name of trailerFiles) expect(source).toContain(`/assets/landing/${name}`);
    for (const name of trailerFiles.slice(1)) expect(existsSync(landingAsset(name))).toBe(true);
    // The video is media.json-pinned, not in git or the image; keep the web cut light.
    expect(existsSync(landingAsset("veydrift-trailer-v1.mp4"))).toBe(false);
    expect(mediaManifest.files["assets/landing/veydrift-trailer-v1.mp4"].bytes).toBeLessThan(90 * 1024 * 1024);
    expect(await Bun.file(landingAsset("veydrift-trailer-v1.vtt")).text()).toStartWith("WEBVTT\n");
  });

  test("Pact shares the player below its hero and links to it without leaving the page", async () => {
    const source = await Bun.file(pactSource).text();
    expect(source).toContain('import { TrailerPlayer } from "./TrailerPlayer"');
    expect(source).toContain('<TrailerPlayer />');
    expect(source.indexOf('<TrailerPlayer />')).toBeLessThan(source.indexOf('<Section eyebrow="Traction"'));
    expect(source).toContain('id="trailer" tabIndex={-1}');
    expect(source).toContain('href="#trailer">Watch the trailer</a>');
    expect(source).not.toContain('href="/">Watch the trailer');
    for (const name of trailerFiles) expect(source).not.toContain(name);
  });

  test("keeps the shared player lightweight, inline, accessible and captioned", async () => {
    const source = await Bun.file(playerSource).text();
    expect(source).toContain('preload="none"');
    expect(source).not.toContain("autoPlay");
    expect(source).toContain("playsInline");
    expect(source).toContain('aria-label="Play the two-minute Veydrift trailer"');
    expect(source).toContain('<track kind="captions" label="English"');
  });

  test("labels trailer media for browsers", () => {
    expect(responseHeadersFor("/assets/landing/veydrift-trailer-v1.mp4")["content-type"]).toBe("video/mp4");
    expect(responseHeadersFor("/assets/landing/veydrift-trailer-v1.vtt")["content-type"]).toBe("text/vtt; charset=utf-8");
  });

  test("serves video byte ranges, which Safari needs to play it", async () => {
    const dist = new URL("../dist/", import.meta.url);
    const file = new URL("range-test.mp4", dist);
    mkdirSync(dist, { recursive: true });
    writeFileSync(file, Uint8Array.from({ length: 1000 }, (_, i) => i % 256));
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: frontendResponse });
    const url = new URL("/range-test.mp4", server.url);
    const bytes = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())];
    try {
      const whole = await fetch(url);
      expect(whole.status).toBe(200);
      expect(whole.headers.get("accept-ranges")).toBe("bytes");
      expect(whole.headers.get("content-type")).toBe("video/mp4");
      expect((await bytes(whole)).length).toBe(1000);

      const part = await fetch(url, { headers: { range: "bytes=10-19" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
      expect(await bytes(part)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

      const tail = await fetch(url, { headers: { range: "bytes=995-" } });
      expect(tail.headers.get("content-range")).toBe("bytes 995-999/1000");
      expect(await bytes(tail)).toEqual([227, 228, 229, 230, 231]);

      const suffix = await fetch(url, { headers: { range: "bytes=-3" } });
      expect(suffix.headers.get("content-range")).toBe("bytes 997-999/1000");

      const beyond = await fetch(url, { headers: { range: "bytes=1000-" } });
      expect(beyond.status).toBe(416);
      expect(beyond.headers.get("content-range")).toBe("bytes */1000");
    } finally {
      server.stop(true);
      rmSync(file);
    }
  });

  test("serves the pinned trailer from the media root with byte ranges and immutable caching", async () => {
    await syncMedia();
    const { bytes } = mediaManifest.files["assets/landing/veydrift-trailer-v1.mp4"];
    const response = await frontendResponse(new Request("http://localhost/assets/landing/veydrift-trailer-v1.mp4", { headers: { range: "bytes=0-9" } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-9/${bytes}`);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  }, 600_000);
});
