import { generateJSON } from "@tiptap/html";
import { getTiptapExtensions } from "@/lib/tiptapExtensions";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function isJsonDocString(content: string) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && parsed.type === "doc";
  } catch {
    return false;
  }
}

function looksLikeHtml(content: string) {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

export function normalizeDocContentForSave(content: string | object | null | undefined) {
  if (!content) return JSON.stringify(EMPTY_DOC);

  if (typeof content === "object") {
    return JSON.stringify(content);
  }

  if (typeof content === "string") {
    if (isJsonDocString(content)) {
      return content;
    }

    if (!looksLikeHtml(content)) {
      return content;
    }

    try {
      const json = generateJSON(content, getTiptapExtensions());
      return JSON.stringify(json);
    } catch (error) {
      console.warn("[Docs] Failed to convert HTML to TipTap JSON, keeping original content.", error);
      return content;
    }
  }

  return JSON.stringify(EMPTY_DOC);
}
