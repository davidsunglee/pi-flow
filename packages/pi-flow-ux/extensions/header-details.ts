import type { ExtensionAPI, ExtensionCommandContext, MessageRenderer, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CATEGORY_ORDER, HEADER_MARGIN, collectResourceSnapshot, createDefaultSnapshotSources, type ResourceItem, type ResourceSnapshot } from "./header-data.ts";

export const HEADER_DETAILS_MESSAGE_TYPE = "pi-flow-ux:header-details";
export const FULL_DETAILS_TITLE = "pi header details";
/** Source sub-lines appear when usable width (width minus the 2-col margin) is at least this. */
export const WIDE_LAYOUT_MIN_USABLE_WIDTH = 72;
export type DetailsColorize = (token: ThemeColor, text: string) => string;

export function buildFullDetailsLines(snapshot: ResourceSnapshot, width: number, colorize: DetailsColorize): string[] {
  const wide = width - HEADER_MARGIN.length >= WIDE_LAYOUT_MIN_USABLE_WIDTH;
  const lines: string[] = [];

  const guard = (line: string): string => {
    if (line.length > 0 && visibleWidth(line) > width) {
      return truncateToWidth(line, Math.max(0, width), "");
    }
    return line;
  };

  lines.push(guard(HEADER_MARGIN + colorize("mdHeading", FULL_DETAILS_TITLE)));
  lines.push("");

  for (const category of CATEGORY_ORDER) {
    const items: ResourceItem[] = snapshot[category];
    const n = items.length;
    lines.push(guard(HEADER_MARGIN + colorize("mdHeading", category) + " " + colorize("muted", "(" + n + ")")));
    if (n === 0) {
      lines.push(guard("    " + colorize("muted", "none")));
    } else {
      for (const item of items) {
        const itemLine = "    " + colorize("toolOutput", item.name) + (item.active ? " " + colorize("muted", "*active") : "");
        lines.push(guard(itemLine));
        if (wide && item.detail) {
          lines.push(guard("      " + colorize("muted", item.detail)));
        }
      }
    }
    lines.push("");
  }

  return lines;
}

export function buildFullDetailsPlainText(snapshot: ResourceSnapshot): string {
  return buildFullDetailsLines(snapshot, Number.MAX_SAFE_INTEGER, (_token, text) => text).join("\n");
}

export function parseSnapshotDetails(details: unknown): ResourceSnapshot | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined;
  const obj = details as Record<string, unknown>;
  for (const category of CATEGORY_ORDER) {
    if (!Array.isArray(obj[category])) return undefined;
  }
  const result = {} as ResourceSnapshot;
  for (const category of CATEGORY_ORDER) {
    const raw = obj[category] as unknown[];
    result[category] = raw
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
      .filter((entry) => typeof entry["name"] === "string")
      .map((entry) => {
        const item: { name: string; detail?: string; active?: boolean } = { name: entry["name"] as string };
        if (typeof entry["detail"] === "string") item.detail = entry["detail"] as string;
        if (typeof entry["active"] === "boolean") item.active = entry["active"] as boolean;
        return item;
      });
  }
  return result;
}

export function createHeaderDetailsRenderer(): MessageRenderer {
  return (message, _options, theme) => {
    const snapshot = parseSnapshotDetails((message as { details?: unknown }).details);
    if (!snapshot) return undefined;
    return {
      render: (width: number) => buildFullDetailsLines(snapshot, width, (token, text) => theme.fg(token, text)),
      invalidate() {},
    };
  };
}

export async function showHeaderDetails(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const snapshot = await collectResourceSnapshot(createDefaultSnapshotSources(pi, ctx));
  pi.sendMessage({
    customType: HEADER_DETAILS_MESSAGE_TYPE,
    content: buildFullDetailsPlainText(snapshot),
    display: true,
    details: snapshot,
  });
}
