import { describe, expect, it } from "vitest";
import { linkifyMessage, normalizeUrlHref } from "@/lib/linkify";

describe("linkifyMessage", () => {
  it("convierte URLs https en enlaces", () => {
    expect(linkifyMessage("Mira https://nanovoices.com ahora")).toEqual([
      { type: "text", text: "Mira " },
      { type: "link", text: "https://nanovoices.com", href: "https://nanovoices.com/" },
      { type: "text", text: " ahora" },
    ]);
  });

  it("convierte dominios sin protocolo a https", () => {
    expect(normalizeUrlHref("nanovoices.com")).toBe("https://nanovoices.com/");
  });

  it("no incluye puntuación final en el enlace", () => {
    expect(linkifyMessage("Visita nanovoices.com.")).toEqual([
      { type: "text", text: "Visita " },
      { type: "link", text: "nanovoices.com", href: "https://nanovoices.com/" },
      { type: "text", text: "." },
    ]);
  });

  it("rechaza protocolos no seguros", () => {
    expect(normalizeUrlHref("javascript:alert(1)")).toBeNull();
  });
});
