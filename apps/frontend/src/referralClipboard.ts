export type ReferralCopyOutcome = "copied" | "unavailable";

export type ReferralCopyEnvironment = {
  clipboard?: { writeText: (text: string) => Promise<void> } | undefined;
  document?: {
    body?: { append: (...nodes: any[]) => void } | undefined;
    createElement: (tagName: string) => {
      ariaHidden?: string;
      readOnly?: boolean;
      style: Partial<CSSStyleDeclaration>;
      value: string;
      select: () => void;
      remove: () => void;
    };
    execCommand?: (command: string) => boolean;
  } | undefined;
};

// Clipboard access is absent or denied in some Mini App webviews. Keep a synchronous legacy
// fallback and return a truthy result only when the text was actually copied; the UI also exposes
// a selectable code as the final manual fallback.
export async function copyReferralText(
  text: string,
  environment: ReferralCopyEnvironment = {
    clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
    document: typeof document === "undefined" ? undefined : document
  }
): Promise<ReferralCopyOutcome> {
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(text);
      return "copied";
    } catch {
      // Try the same user gesture through the legacy path below.
    }
  }

  const documentRef = environment.document;
  if (!documentRef?.body || !documentRef.execCommand) return "unavailable";
  const input = documentRef.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.ariaHidden = "true";
  input.style.position = "fixed";
  input.style.opacity = "0";
  documentRef.body.append(input);
  input.select();
  const copied = documentRef.execCommand("copy");
  input.remove();
  return copied ? "copied" : "unavailable";
}
