export type MessagePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "link";
      text: string;
      href: string;
    };

const URL_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/;

export function linkifyMessage(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;

  for (const match of message.matchAll(URL_PATTERN)) {
    const rawMatch = match[0];
    const start = match.index ?? 0;
    const { urlText, trailingText } = splitTrailingPunctuation(rawMatch);
    const href = normalizeUrlHref(urlText);

    if (!href) {
      continue;
    }

    if (start > lastIndex) {
      parts.push({ type: "text", text: message.slice(lastIndex, start) });
    }

    parts.push({ type: "link", text: urlText, href });

    if (trailingText) {
      parts.push({ type: "text", text: trailingText });
    }

    lastIndex = start + rawMatch.length;
  }

  if (lastIndex < message.length) {
    parts.push({ type: "text", text: message.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: "text", text: message }];
}

export function normalizeUrlHref(urlText: string) {
  const trimmed = urlText.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function splitTrailingPunctuation(value: string) {
  const trailing = value.match(TRAILING_PUNCTUATION)?.[0] ?? "";

  if (!trailing) {
    return { urlText: value, trailingText: "" };
  }

  return {
    urlText: value.slice(0, -trailing.length),
    trailingText: trailing,
  };
}
