import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NanoVoices",
  description: "Posicionamiento de mensajes por cuentas Nano verificadas por transferencia.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
