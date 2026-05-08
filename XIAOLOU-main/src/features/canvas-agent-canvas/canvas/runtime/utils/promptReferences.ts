export type PromptReferenceInfo = {
  id: string;
  label?: string;
};

const PROMPT_REFERENCE_TOKEN_RE = /@\[ref:([^\]]+)\]/g;

function decodeReferenceId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createPromptReferenceToken(referenceId: string) {
  return `@[ref:${encodeURIComponent(referenceId)}]`;
}

export function getPromptReferenceLabel(
  referenceId: string,
  references: PromptReferenceInfo[] = [],
) {
  const index = references.findIndex((item) => item.id === referenceId);
  if (index >= 0) {
    return references[index].label || `参考图${index + 1}`;
  }
  return "参考图";
}

export function normalizePromptReferenceTokens(
  value: string,
  references: PromptReferenceInfo[] = [],
) {
  return String(value || "").replace(PROMPT_REFERENCE_TOKEN_RE, (_match, rawId) => {
    const referenceId = decodeReferenceId(String(rawId || ""));
    return `@${getPromptReferenceLabel(referenceId, references)}`;
  });
}

export function splitPromptReferenceTokens(value: string) {
  const chunks: Array<{ type: "text"; value: string } | { type: "reference"; id: string }> = [];
  const source = String(value || "");
  let lastIndex = 0;
  PROMPT_REFERENCE_TOKEN_RE.lastIndex = 0;

  for (const match of source.matchAll(PROMPT_REFERENCE_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      chunks.push({ type: "text", value: source.slice(lastIndex, index) });
    }
    chunks.push({ type: "reference", id: decodeReferenceId(String(match[1] || "")) });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < source.length) {
    chunks.push({ type: "text", value: source.slice(lastIndex) });
  }

  return chunks;
}
