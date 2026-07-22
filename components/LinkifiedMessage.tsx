import { linkifyMessage } from "@/lib/linkify";

export function LinkifiedMessage({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <p className={className}>
      {linkifyMessage(text).map((part, index) =>
        part.type === "link" ? (
          <a
            className="font-semibold text-[var(--nano-blue)] underline underline-offset-4"
            href={part.href}
            key={`${part.href}-${index}`}
            rel="noopener noreferrer nofollow ugc"
            target="_blank"
          >
            {part.text}
          </a>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </p>
  );
}
