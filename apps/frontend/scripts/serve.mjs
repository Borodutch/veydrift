import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const distRoot = new URL("../dist/", import.meta.url);
const publicRoot = new URL("../public/", import.meta.url);
const port = Number(process.env.PORT || 80);
const apiBaseUrl = (process.env.VEYDRIFT_PUBLIC_API_URL || process.env.VITE_VEYDRIFT_API_URL || "https://api-test.veydrift.com").replace(/\/+$/, "");
const siteName = "Veydrift";
const ogImageCache = new Map();
const ogDataCache = new Map();
const assetDataCache = new Map();
let sharpModule;
const defaultMetadataTimeoutMs = 1_500;
export const referralXCardImageVersion = "2";

export const referralOgLayout = Object.freeze({
  titleX: 58,
  titleY: 192,
  titleFontSize: 82,
  titleSafeRight: 672,
  titleSafeBottom: 212,
  codeTop: 258,
  codeBaselineY: 286,
  codeBottom: 296,
  codeSafeRight: 672,
  supportingX: 92,
  supportingTop: 310,
  supportingBaselineY: 336,
  supportingBottom: 344,
  supportingFontSize: 24,
  supportingSafeRight: 672,
  footerTop: 548,
  planetLeft: 704,
  planetTop: 18,
  planetSize: 488,
  minimumTitlePlanetGap: 32,
});

const planetAssets = {
  "cold-tundra": "/assets/game/style-pass/generated/planets/cold-tundra.webp",
  "cool-misty-blue": "/assets/game/style-pass/generated/planets/cool-misty-blue.webp",
  "crystal-violet": "/assets/game/style-pass/generated/planets/crystal-violet.webp",
  "deuterium-blue": "/assets/game/style-pass/generated/planets/deuterium-blue.webp",
  "frozen-ice": "/assets/game/style-pass/generated/planets/frozen-ice.webp",
  "hot-desert": "/assets/game/style-pass/generated/planets/hot-desert.webp",
  "lush-temperate": "/assets/game/style-pass/generated/planets/lush-temperate.webp",
  "metal-planetoid": "/assets/game/style-pass/generated/planets/metal-planetoid.webp",
  "outer-cryo": "/assets/game/style-pass/generated/planets/outer-cryo.webp",
  "scorching-molten": "/assets/game/style-pass/generated/planets/scorching-molten.webp",
  "temperate-ocean": "/assets/game/style-pass/generated/planets/temperate-ocean.webp",
  "warm-terracotta": "/assets/game/style-pass/generated/planets/warm-terracotta.webp",
};

const commanderAsset = "/assets/game/style-pass/high-res/small-cargo-alive-fullship-2k.webp";
const fallbackBackgroundAsset = "/assets/miniapp/og-image.jpg";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function contentType(pathname) {
  const match = pathname.match(/\.[^.]+$/);
  return match ? contentTypes[match[0]] : undefined;
}

export function cacheControl(pathname) {
  if (pathname.startsWith("/assets/game/sizes/")) {
    return "public, max-age=31536000, immutable";
  }

  if (pathname.startsWith("/assets/game/")) {
    return "public, max-age=604800";
  }

  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }

  if (pathname === "/index.html") {
    return "no-cache";
  }

  return undefined;
}

export function responseHeadersFor(pathname) {
  const headers = {};
  const type = contentType(pathname);
  const cache = cacheControl(pathname);

  if (type) headers["content-type"] = type;
  if (cache) headers["cache-control"] = cache;

  return headers;
}

function staticFileUrl(pathname, root = distRoot) {
  return new URL(`.${pathname}`, root);
}

function responseFor(file, pathname) {
  const headers = responseHeadersFor(pathname);

  return new Response(file, { headers });
}

function docsAppRouteForPathname(pathname) {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

function playAppRouteForPathname(pathname) {
  return pathname === "/play" || pathname.startsWith("/play/");
}

export function inviteAppRouteForPathname(pathname) {
  return pathname === "/invite" || pathname === "/alliance-invites";
}

const gameAppPaths = new Set([
  "/overview",
  "/infrastructure",
  "/defenses",
  "/research",
  "/shipyard",
  "/mission-control",
  "/missions",
  "/moon",
  "/alliance",
  "/rift",
  "/rankings",
  "/galaxy",
  "/raid-target-finder",
  "/planet",
  "/battle-reports",
]);

export function gameAppRouteForPathname(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return gameAppPaths.has(normalized);
}

export function shareRouteForUrl(url) {
  const referralCode = referralCodeForCanonical(url.searchParams.get("ref"));
  if ((url.pathname === "/" || url.pathname === "/index.html") && referralCode) {
    return { kind: "referral", code: referralCode };
  }

  return shareRouteForPathname(url.pathname);
}

function shareRouteForPathname(pathname) {
  const mission = pathname.match(/^\/mission\/([0-9]+)$/);
  if (mission) return { kind: "mission", id: mission[1] };

  const missionReport = pathname.match(/^\/mission-control\/report\/([0-9]+)$/);
  if (missionReport) return { kind: "mission", id: missionReport[1] };

  const planet = pathname.match(/^\/planet\/([0-9]+)\/([0-9]+)\/([0-9]+)$/);
  if (planet) {
    return {
      kind: "planet",
      galaxy: Number(planet[1]),
      system: Number(planet[2]),
      position: Number(planet[3]),
    };
  }

  const moon = pathname.match(/^\/moon\/([0-9]+)\/([0-9]+)\/([0-9]+)$/);
  if (moon) {
    return {
      kind: "moon",
      galaxy: Number(moon[1]),
      system: Number(moon[2]),
      position: Number(moon[3]),
    };
  }

  const player = pathname.match(/^\/player\/([^/]+)$/);
  if (player) return { kind: "player", wallet: decodeURIComponent(player[1]) };

  const alliance = pathname.match(/^\/alliance\/([^/]+)$/);
  if (alliance) return { kind: "alliance", allianceId: decodeURIComponent(alliance[1]) };

  return null;
}

export function imageRouteForPathname(pathname) {
  if (pathname === "/og/referral.png") return { kind: "referral" };

  const referral = pathname.match(/^\/og\/referral\/([A-Za-z0-9_-]{1,24})\.png$/);
  if (referral) return { kind: "referral", code: referral[1].toLowerCase() };

  const mission = pathname.match(/^\/og\/mission\/([0-9]+)\.png$/);
  if (mission) return { kind: "mission", id: mission[1] };

  const planet = pathname.match(/^\/og\/planet\/([0-9]+)\/([0-9]+)\/([0-9]+)\.png$/);
  if (planet) {
    return {
      kind: "planet",
      galaxy: Number(planet[1]),
      system: Number(planet[2]),
      position: Number(planet[3]),
    };
  }

  const moon = pathname.match(/^\/og\/moon\/([0-9]+)\/([0-9]+)\/([0-9]+)\.png$/);
  if (moon) {
    return {
      kind: "moon",
      galaxy: Number(moon[1]),
      system: Number(moon[2]),
      position: Number(moon[3]),
    };
  }

  const player = pathname.match(/^\/og\/player\/([^/]+)\.png$/);
  if (player) return { kind: "player", wallet: decodeURIComponent(player[1]) };

  const alliance = pathname.match(/^\/og\/alliance\/([^/]+)\.png$/);
  if (alliance) return { kind: "alliance", allianceId: decodeURIComponent(alliance[1]) };

  return null;
}

function sharePathForRoute(route) {
  if (route.kind === "referral") return "/";
  if (route.kind === "mission") return `/mission/${encodeURIComponent(route.id)}`;
  if (route.kind === "planet") return `/planet/${route.galaxy}/${route.system}/${route.position}`;
  if (route.kind === "moon") return `/moon/${route.galaxy}/${route.system}/${route.position}`;
  if (route.kind === "player") return `/player/${encodeURIComponent(route.wallet)}`;
  return `/alliance/${encodeURIComponent(route.allianceId)}`;
}

function imagePathForRoute(route) {
  if (route.kind === "referral") {
    return route.code
      ? `/og/referral/${encodeURIComponent(route.code)}.png`
      : "/og/referral.png";
  }
  if (route.kind === "mission") return `/og/mission/${encodeURIComponent(route.id)}.png`;
  if (route.kind === "planet") return `/og/planet/${route.galaxy}/${route.system}/${route.position}.png`;
  if (route.kind === "moon") return `/og/moon/${route.galaxy}/${route.system}/${route.position}.png`;
  if (route.kind === "player") return `/og/player/${encodeURIComponent(route.wallet)}.png`;
  return `/og/alliance/${encodeURIComponent(route.allianceId)}.png`;
}

export async function routeMeta(route) {
  const key = JSON.stringify(route);
  const cached = ogDataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await buildRouteMeta(route).catch(() => fallbackMeta(route));
  ogDataCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

async function buildRouteMeta(route) {
  if (route.kind === "referral") return referralMeta(route.code);
  if (route.kind === "mission") return missionMeta(route.id);
  if (route.kind === "planet") return planetMeta(route);
  if (route.kind === "moon") return moonMeta(route);
  if (route.kind === "player") return playerMeta(route.wallet);
  return allianceMeta(route.allianceId);
}

function referralMeta(code = "") {
  const inviteCode = referralCodeForCanonical(code);
  return {
    kind: "referral",
    title: inviteCode ? `Join Veydrift with ${inviteCode}` : "Join Veydrift",
    imageTitle: "Veydrift Invite",
    description: inviteCode
      ? `Use invite code ${inviteCode}. Eligibility and exact benefits are verified in-game before settlement.`
      : "Open this Veydrift invite. Referral eligibility and exact benefits are verified in-game before settlement.",
    status: inviteCode ? `CODE ${inviteCode}` : "INVITE LINK",
    supportingCopy: inviteCode ? "Use this code to start with 2× resources" : "",
    subtitle: inviteCode ? "" : "Benefits verified in-game",
    accent: "#5eead4",
    footer: "veydrift.com",
    commander: true,
    planetAssets: [planetAssets["temperate-ocean"], planetAssets["crystal-violet"]],
  };
}

async function missionMeta(id) {
  const detail = await fetchJson(`/mission/${encodeURIComponent(id)}`);
  const mission = detail?.mission ?? {};
  const report = detail?.battleReport ?? null;
  const origin = mission.originPlanet ?? null;
  const target = mission.targetPlanet ?? null;
  const originName = planetLabel(origin);
  const targetName = planetLabel(target);
  const route = `${originName} -> ${targetName}`;
  const type = missionTypeLabel(mission.missionType);
  const status = missionStatusLabel(mission, report);
  const originAsset = planetAssetFor(origin?.archetype);
  const targetAsset = planetAssetFor(target?.archetype);

  return {
    kind: "mission",
    title: `${type} #${id}`,
    description: `${status} · ${route}`,
    status,
    subtitle: route,
    accent: status === "Victory" ? "#8cffc8" : status === "Defeat" ? "#ff6b62" : "#7dd3fc",
    planetAssets: [originAsset, targetAsset],
  };
}

async function planetMeta(route) {
  const system = await fetchJson(`/universe/galaxies/${route.galaxy}/systems/${route.system}`);
  const planet = system?.planets?.find((candidate) => Number(candidate.position) === route.position) ?? {};
  let settled = null;
  if (planet.occupiedBy?.planetId) {
    settled = await fetchJson(`/planets/${encodeURIComponent(planet.occupiedBy.planetId)}`).catch(() => null);
  }
  const archetype = settled?.archetype ?? planet.archetype ?? planetTypeFromTemperature(settled?.temperature ?? planet.temperature);
  const name = (settled?.name || planet.name || "").trim() || `Planet ${route.galaxy}:${route.system}:${route.position}`;
  const type = formatPlanetType(archetype);

  return {
    kind: "planet",
    title: name,
    description: `${route.galaxy}:${route.system}:${route.position}`,
    status: type.toUpperCase(),
    subtitle: `${route.galaxy}:${route.system}:${route.position}`,
    accent: "#67e8f9",
    planetAssets: [planetAssetFor(archetype)],
  };
}

async function moonMeta(route) {
  const system = await fetchJson(`/universe/galaxies/${route.galaxy}/systems/${route.system}`);
  const planet = system?.planets?.find((candidate) => Number(candidate.position) === route.position) ?? {};
  const archetype = planet.archetype ?? planetTypeFromTemperature(planet.temperature);
  const parentName = (planet.name || "").trim() || `Planet ${route.galaxy}:${route.system}:${route.position}`;
  const moonName = (planet.moonName || "").trim() || "Moon";
  const type = formatPlanetType(archetype);

  return {
    kind: "moon",
    title: moonName,
    description: `Moon orbiting ${parentName}`,
    status: "MOON",
    subtitle: `${route.galaxy}:${route.system}:${route.position} · ${type}`,
    accent: "#67e8f9",
    planetAssets: [planetAssetFor(archetype)],
  };
}

async function playerMeta(wallet) {
  const [profile, highscore] = await Promise.all([
    fetchJson(`/wallet/${encodeURIComponent(wallet)}/profile`).catch(() => null),
    fetchJson(`/wallet/${encodeURIComponent(wallet)}/highscore`).catch(() => null),
  ]);
  const displayName = profile?.displayName?.trim() || highscore?.displayName?.trim() || shortAddress(wallet);
  const alliance = highscore?.alliance?.tag ? highscore.alliance.tag : null;
  const rank = highscore?.rank ? `Rank #${highscore.rank}` : null;

  return {
    kind: "player",
    title: displayName,
    description: `Commander${alliance ? ` · ${alliance}` : ""}`,
    status: rank ?? shortAddress(wallet),
    subtitle: `Commander${alliance ? ` · ${alliance}` : ""}`,
    accent: "#a7f3d0",
    commander: true,
  };
}

async function allianceMeta(allianceId) {
  const detail = await fetchJson(`/alliance/${encodeURIComponent(allianceId)}`).catch(() => null);
  const alliance = detail?.alliance ?? detail;
  const tag = alliance?.tag?.trim() || `#${allianceId}`;
  const name = alliance?.name?.trim() || "Alliance";
  const memberCount = Number(alliance?.memberCount);

  return {
    kind: "alliance",
    title: tag,
    description: name,
    status: Number.isFinite(memberCount) ? `${memberCount} MEMBERS` : "ALLIANCE",
    subtitle: name,
    accent: "#c4b5fd",
    commander: true,
  };
}

function fallbackMeta(route) {
  if (route.kind === "referral") return referralMeta(route.code);

  if (route.kind === "mission") {
    return {
      kind: "mission",
      title: `Mission #${route.id}`,
      description: "Veydrift",
      status: "VEYDRIFT",
      subtitle: "Veydrift",
      accent: "#7dd3fc",
      planetAssets: [planetAssets["temperate-ocean"], planetAssets["frozen-ice"]],
    };
  }
  if (route.kind === "planet") {
    return {
      kind: "planet",
      title: `Planet ${route.galaxy}:${route.system}:${route.position}`,
      description: "Veydrift",
      status: "PLANET",
      subtitle: `${route.galaxy}:${route.system}:${route.position}`,
      accent: "#67e8f9",
      planetAssets: [planetAssets["frozen-ice"]],
    };
  }
  if (route.kind === "moon") {
    return {
      kind: "moon",
      title: `Moon ${route.galaxy}:${route.system}:${route.position}`,
      description: "Veydrift",
      status: "MOON",
      subtitle: `${route.galaxy}:${route.system}:${route.position}`,
      accent: "#67e8f9",
      planetAssets: [planetAssets["frozen-ice"]],
    };
  }
  if (route.kind === "player") {
    return {
      kind: "player",
      title: shortAddress(route.wallet),
      description: "Commander",
      status: shortAddress(route.wallet),
      subtitle: "Commander",
      accent: "#a7f3d0",
      commander: true,
    };
  }
  return {
    kind: "alliance",
    title: `Alliance #${route.allianceId}`,
    description: "Veydrift",
    status: "ALLIANCE",
    subtitle: "Veydrift",
    accent: "#c4b5fd",
    commander: true,
  };
}

function metadataFetchTimeoutMs() {
  const value = Number(process.env.VEYDRIFT_OG_METADATA_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : defaultMetadataTimeoutMs;
}

async function fetchJson(pathname) {
  const timeoutMs = metadataFetchTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(`${apiBaseUrl}${pathname}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API ${pathname} returned ${response.status}`);
    return response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`API ${pathname} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function planetLabel(planet) {
  if (!planet) return "Planet";
  return planet.name?.trim() || `Planet ${planet.position ?? planet.planetId ?? ""}`.trim();
}

function missionTypeLabel(value) {
  if (!value) return "Mission";
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function missionStatusLabel(mission, report) {
  if (report?.outcome === "AttackerWin") return "Victory";
  if (report?.outcome === "DefenderWin") return "Defeat";
  if (report?.outcome === "Draw") return "Draw";

  const status = String(mission?.status ?? "").toLowerCase();
  if (status.includes("outbound")) return "En route";
  if (status.includes("return")) return "Returning";
  if (status.includes("resolve")) return "Resolved";
  if (status.includes("complete")) return "Returned";
  return "En route";
}

function planetAssetFor(archetype) {
  return planetAssets[archetype] ?? planetAssets["temperate-ocean"];
}

function planetTypeFromTemperature(temperature) {
  const numeric = Number(temperature);
  if (!Number.isFinite(numeric)) return "temperate-ocean";
  if (numeric <= -35) return "frozen-ice";
  if (numeric <= -10) return "cold-tundra";
  if (numeric <= 10) return "temperate-ocean";
  if (numeric <= 25) return "lush-temperate";
  if (numeric <= 40) return "warm-terracotta";
  if (numeric <= 55) return "hot-desert";
  return "scorching-molten";
}

function formatPlanetType(type) {
  return String(type ?? "planet").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function shortAddress(value) {
  const text = String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

async function shareHtmlResponse(request, route) {
  const url = new URL(request.url);
  const origin = publicOrigin(request, url);
  const meta = await routeMeta(route);
  const canonicalPath = canonicalSharePathForRoute(route, url);
  const canonicalUrl = `${origin}${canonicalPath}`;
  const imagePath = imagePathForRoute(route);
  const imageUrl = route.kind === "referral" && route.code
    ? `${origin}${imagePath}?v=${encodeURIComponent(referralXCardImageVersion)}`
    : `${origin}${imagePath}`;
  const launchUrl = route.kind === "referral" ? miniAppLaunchUrl(canonicalUrl) : null;
  const appHtml = await readFile(staticFileUrl("/index.html"), "utf8");
  const html = injectShareMeta(appHtml, {
    canonicalUrl,
    description: meta.description,
    imageUrl,
    launchUrl,
    title: meta.title,
  });

  return new Response(html, {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

export function canonicalSharePathForRoute(route, url) {
  if (route.kind !== "referral") return sharePathForRoute(route);

  const code = referralCodeForCanonical(url.searchParams.get("ref"));
  if (!code) return "/";

  return `/?ref=${encodeURIComponent(code)}`;
}

function referralCodeForCanonical(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,24}$/.test(text) ? text : "";
}

function miniAppLaunchUrl(canonicalUrl) {
  const url = new URL(canonicalUrl);
  url.searchParams.set("miniApp", "true");
  return url.toString();
}

export function buildReferralMiniAppEmbed({ imageUrl, launchUrl, actionType = "launch_miniapp" }) {
  return {
    version: "1",
    imageUrl,
    aspectRatio: "3:2",
    button: {
      title: "Accept invite",
      action: {
        type: actionType,
        name: "Veydrift",
        url: launchUrl,
        splashImageUrl: `${new URL(launchUrl).origin}/assets/miniapp/splash.png`,
        splashBackgroundColor: "#05070d",
      },
    },
  };
}

export function injectShareMeta(html, { canonicalUrl, description, imageUrl, launchUrl, title }) {
  let nextHtml = html;
  nextHtml = replaceHeadTag(nextHtml, /<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`);
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/s,
    `<meta name="description" content="${escapeHtml(description)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/s,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:image:type"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:image:type" content="image/png" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/>/s,
    `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/s,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/s,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/s,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
  );
  nextHtml = replaceHeadTag(
    nextHtml,
    /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/>/s,
    `<meta name="twitter:image:alt" content="${escapeHtml(title)}" />`,
  );
  if (launchUrl) {
    nextHtml = replaceHeadTag(
      nextHtml,
      /<meta\s+name="fc:miniapp"\s+content='[^']*'\s*\/>/s,
      `<meta name="fc:miniapp" content='${escapeHtml(JSON.stringify(buildReferralMiniAppEmbed({ imageUrl, launchUrl })))}' />`,
    );
    nextHtml = replaceHeadTag(
      nextHtml,
      /<meta\s+name="fc:frame"\s+content='[^']*'\s*\/>/s,
      `<meta name="fc:frame" content='${escapeHtml(JSON.stringify(buildReferralMiniAppEmbed({ imageUrl, launchUrl, actionType: "launch_frame" })))}' />`,
    );
  }
  return nextHtml;
}

function replaceHeadTag(html, pattern, replacement) {
  if (pattern.test(html)) return html.replace(pattern, replacement);
  return html.replace("</head>", `    ${replacement}\n  </head>`);
}

function publicOrigin(request, url) {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.endsWith("veydrift.com") ? "https" : url.protocol.replace(/:$/, ""));
  return `${protocol}://${host}`;
}

async function ogImageResponse(route) {
  const cacheKey = JSON.stringify(route);
  const cached = ogImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(cached.body.slice(0), { headers: ogImageHeaders() });
  }

  const meta = await routeMeta(route);
  const body = await ogPng(meta);
  ogImageCache.set(cacheKey, { body, expiresAt: Date.now() + 300_000 });
  return new Response(body.slice(0), { headers: ogImageHeaders() });
}

function ogImageHeaders() {
  return {
    "cache-control": "public, max-age=300",
    "content-type": "image/png",
  };
}

export async function ogPng(meta) {
  const sharp = await getSharp();
  const compositeReferralPlanet = meta.kind === "referral" && Boolean(meta.planetAssets?.[0]);
  const svg = await ogSvg(meta, {
    omitReferralTitle: compositeReferralPlanet,
    omitReferralVisual: compositeReferralPlanet,
  });
  if (!compositeReferralPlanet) return sharp(Buffer.from(svg)).png().toBuffer();

  const planetSource = await readFile(existingAssetUrl(meta.planetAssets[0]));
  const planet = await sharp(planetSource)
    .resize({
      width: referralOgLayout.planetSize,
      height: referralOgLayout.planetSize,
      fit: "contain",
    })
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .png()
    .toBuffer();
  const routeOverlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <path d="M744 410 C838 336 944 268 1090 178" fill="none" stroke="${meta.accent ?? "#7dd3fc"}" stroke-width="2" stroke-opacity=".38"/>
  <circle cx="744" cy="410" r="4" fill="${meta.accent ?? "#7dd3fc"}"/>
  <circle cx="1090" cy="178" r="4" fill="${meta.accent ?? "#7dd3fc"}"/>
</svg>`);
  const titleOverlay = await referralTitleComposite(sharp, meta.imageTitle ?? meta.title);

  return sharp(Buffer.from(svg))
    .composite([
      {
        input: planet,
        left: referralOgLayout.planetLeft,
        top: referralOgLayout.planetTop,
        blend: "over",
      },
      { input: routeOverlay, left: 0, top: 0, blend: "over" },
      titleOverlay,
    ])
    .png()
    .toBuffer();
}

export async function ogSvg(meta, { omitReferralTitle = false, omitReferralVisual = false } = {}) {
  const isReferral = meta.kind === "referral";
  const background = meta.kind === "referral"
    ? null
    : await assetDataUri(fallbackBackgroundAsset, 1200);
  const title = fitText(meta.imageTitle ?? meta.title, 26);
  const subtitle = fitText(meta.subtitle ?? meta.description, 32);
  const supportingCopy = fitText(meta.supportingCopy ?? "", 56);
  const status = fitText(meta.status, 24).toUpperCase();
  const footer = fitText(meta.footer ?? "test.veydrift.com", 34);
  const accent = meta.accent ?? "#7dd3fc";
  const commander = meta.commander && meta.kind !== "referral"
    ? await assetDataUri(commanderAsset, 860)
    : null;
  const planets = await Promise.all((meta.planetAssets ?? []).map((asset) => assetDataUri(asset, 600)));
  const brandVisual = isReferral
    ? ""
    : `<text x="58" y="82" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="850" fill="#f8fbff">Veydrift</text>`;
  const subtitleVisual = subtitle
    ? `<text x="62" y="304" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" font-weight="780" fill="#d8e2f1">${escapeXml(subtitle)}</text>`
    : "";
  const ruleY = isReferral ? 82 : 132;
  const titleY = isReferral ? referralOgLayout.titleY : 238;
  const statusBarY = isReferral ? referralOgLayout.codeTop : 358;
  const statusTextY = isReferral ? referralOgLayout.codeBaselineY : 386;
  const supportingVisual = isReferral && supportingCopy
    ? `<text x="${referralOgLayout.supportingX}" y="${referralOgLayout.supportingBaselineY}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${referralOgLayout.supportingFontSize}" font-weight="700" fill="#b8c5d6">${escapeXml(supportingCopy)}</text>`
    : "";

  const visual = meta.kind === "referral"
    ? omitReferralVisual
      ? ""
      : `<image href="${planets[0] ?? ""}" x="${referralOgLayout.planetLeft}" y="${referralOgLayout.planetTop}" width="${referralOgLayout.planetSize}" height="${referralOgLayout.planetSize}" preserveAspectRatio="xMidYMid meet"/>
  <path d="M744 410 C838 336 944 268 1090 178" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity=".38"/>
  <circle cx="744" cy="410" r="4" fill="${accent}"/>
  <circle cx="1090" cy="178" r="4" fill="${accent}"/>`
    : meta.kind === "mission"
    ? `<image href="${planets[0] ?? ""}" x="624" y="266" width="320" height="320" preserveAspectRatio="xMidYMid meet" clip-path="url(#missionPlanetA)"/>
  <image href="${planets[1] ?? planets[0] ?? ""}" x="854" y="44" width="320" height="320" preserveAspectRatio="xMidYMid meet" clip-path="url(#missionPlanetB)"/>
  <path d="M812 421 C858 360 906 304 976 218" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity=".58"/>
  <circle cx="812" cy="421" r="4" fill="${accent}"/>
  <circle cx="976" cy="218" r="4" fill="${accent}"/>`
    : meta.kind === "planet"
      ? `<image href="${planets[0] ?? ""}" x="670" y="18" width="520" height="520" preserveAspectRatio="xMidYMid meet" clip-path="url(#singlePlanet)"/>
  <path d="M810 396 C884 340 956 286 1078 184" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity=".40"/>
  <circle cx="810" cy="396" r="4" fill="${accent}"/>
  <circle cx="1078" cy="184" r="4" fill="${accent}"/>`
      : `<image href="${commander ?? ""}" x="492" y="0" width="808" height="630" preserveAspectRatio="xMidYMid slice" opacity=".96"/>
  <path d="M744 414 C820 354 918 302 1064 226" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity=".38"/>
  <circle cx="744" cy="414" r="4" fill="${accent}"/>
  <circle cx="1064" cy="226" r="4" fill="${accent}"/>`;

  const footerVisual = meta.kind === "referral"
    ? `<rect x="60" y="${referralOgLayout.footerTop}" width="42" height="3" fill="${accent}"/>
  <text x="60" y="592" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="850" fill="#f8fbff">${escapeXml(footer)}</text>`
    : `<text x="64" y="596" font-family="DejaVu Sans, Arial, sans-serif" font-size="17" font-weight="760" fill="#71839a">${escapeXml(footer)}</text>`;

  const backgroundVisual = meta.kind === "referral"
    ? ""
    : `<image href="${background}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice" opacity=".18"/>`;
  const titleVisual = isReferral
    ? omitReferralTitle ? "" : referralTitleText(title)
    : `<text x="58" y="${titleY}" font-family="DejaVu Sans, Arial, sans-serif" font-size="82" font-weight="900" fill="#f8fbff">${escapeXml(title)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="shade" x1="0" x2="1">
      <stop offset="0" stop-color="#02050b"/>
      <stop offset=".50" stop-color="#02050b" stop-opacity=".88"/>
      <stop offset=".78" stop-color="#02050b" stop-opacity=".48"/>
      <stop offset="1" stop-color="#02050b" stop-opacity=".20"/>
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="38%" r="50%">
      <stop offset="0" stop-color="${accent}" stop-opacity=".22"/>
      <stop offset=".58" stop-color="#0f172a" stop-opacity=".14"/>
      <stop offset="1" stop-color="#02050b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" x2="1">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset=".56" stop-color="#7dd3fc" stop-opacity=".72"/>
      <stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="missionPlanetA"><circle cx="784" cy="426" r="160"/></clipPath>
    <clipPath id="missionPlanetB"><circle cx="1014" cy="204" r="160"/></clipPath>
    <clipPath id="singlePlanet"><circle cx="930" cy="278" r="260"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#02050b"/>
  ${backgroundVisual}
  <rect width="1200" height="630" fill="url(#glow)"/>
  ${visual}
  <rect width="1200" height="630" fill="url(#shade)"/>
  ${brandVisual}
  <rect x="60" y="${ruleY}" width="520" height="2" fill="url(#rule)"/>
  ${titleVisual}
  ${subtitleVisual}
  <rect x="64" y="${statusBarY}" width="10" height="38" fill="${accent}"/>
  <text x="92" y="${statusTextY}" font-family="DejaVu Sans, Arial, sans-serif" font-size="27" font-weight="850" fill="${accent}">${escapeXml(status)}</text>
  ${supportingVisual}
  ${footerVisual}
</svg>`;
}

function referralTitleSvg(value) {
  const title = fitText(value, 26);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${referralTitleText(title)}
</svg>`;
}

function referralTitleText(title) {
  return `<text x="${referralOgLayout.titleX}" y="${referralOgLayout.titleY}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${referralOgLayout.titleFontSize}" font-weight="900" fill="#f8fbff">${escapeXml(title)}</text>`;
}

async function referralTitleComposite(sharp, value) {
  const { data, info } = await sharp(Buffer.from(referralTitleSvg(value)))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const maximumWidth = referralOgLayout.titleSafeRight - referralOgLayout.titleX;
  const input = info.width > maximumWidth
    ? await sharp(data).resize({ width: maximumWidth, height: info.height, fit: "fill" }).png().toBuffer()
    : data;

  return {
    input,
    left: Math.max(0, -(info.trimOffsetLeft ?? -referralOgLayout.titleX)),
    top: Math.max(0, -(info.trimOffsetTop ?? 0)),
    blend: "over",
  };
}

async function assetDataUri(pathname, maxWidth) {
  const key = `${pathname}:${maxWidth}`;
  const cached = assetDataCache.get(key);
  if (cached) return cached;

  const fileUrl = existingAssetUrl(pathname);
  const buffer = await readFile(fileUrl);
  const sharp = await getSharp();
  const png = await sharp(buffer).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
  const uri = `data:image/png;base64,${png.toString("base64")}`;
  assetDataCache.set(key, uri);
  return uri;
}

async function getSharp() {
  if (!sharpModule) {
    sharpModule = (await import("sharp")).default;
  }
  return sharpModule;
}

function existingAssetUrl(pathname) {
  const distUrl = staticFileUrl(pathname, distRoot);
  if (existsSync(distUrl)) return distUrl;
  const publicUrl = staticFileUrl(pathname, publicRoot);
  if (existsSync(publicUrl)) return publicUrl;
  throw new Error(`Missing OG asset: ${pathname}`);
}

function fitText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

if (import.meta.main) {
  Bun.serve({
    hostname: "0.0.0.0",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }

      const route = pathname === "/" ? "/index.html" : pathname;
      const imageRoute = imageRouteForPathname(pathname);
      if (imageRoute) {
        return ogImageResponse(imageRoute);
      }

      const shareRoute = shareRouteForUrl(url);
      if (shareRoute) {
        return shareHtmlResponse(request, shareRoute);
      }

      const file = Bun.file(new URL(`.${route}`, distRoot));

      if (await file.exists()) {
        return responseFor(file, route);
      }

      if (
        docsAppRouteForPathname(route)
        || playAppRouteForPathname(route)
        || inviteAppRouteForPathname(route)
        || gameAppRouteForPathname(route)
      ) {
        return responseFor(Bun.file(staticFileUrl("/index.html")), "/index.html");
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Veydrift frontend listening on ${port}`);
}
