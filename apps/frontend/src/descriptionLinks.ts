export type DescriptionLinkPart = {
  text: string;
  href?: string;
};

const descriptionUrlPattern = /https?:\/\/[^\s<>"']+/gi;
const trailingUrlPunctuation = /[),.;:!?]+$/;

export function descriptionLinkParts(description: string): DescriptionLinkPart[] {
  const parts: DescriptionLinkPart[] = [];
  let cursor = 0;

  for (const match of description.matchAll(descriptionUrlPattern)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: description.slice(cursor, index) });
    }

    const trimmedUrl = rawUrl.replace(trailingUrlPunctuation, "");
    const trailing = rawUrl.slice(trimmedUrl.length);
    if (isSafeDescriptionUrl(trimmedUrl)) {
      parts.push({ href: trimmedUrl, text: trimmedUrl });
    } else {
      parts.push({ text: trimmedUrl });
    }
    if (trailing) parts.push({ text: trailing });
    cursor = index + rawUrl.length;
  }

  if (cursor < description.length) {
    parts.push({ text: description.slice(cursor) });
  }

  return parts.length ? parts : [{ text: description }];
}

export function isSafeDescriptionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
