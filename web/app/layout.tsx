import type { Metadata, Viewport } from "next";
import manifestSource from "../public/site.webmanifest?raw";
import "./globals.css";

let manifest: unknown;
try {
  manifest = JSON.parse(manifestSource);
} catch (cause) {
  throw new Error("Invalid JSON in web/public/site.webmanifest.", { cause });
}

if (
  manifest === null ||
  typeof manifest !== "object" ||
  Array.isArray(manifest) ||
  !("theme_color" in manifest) ||
  typeof manifest.theme_color !== "string" ||
  manifest.theme_color.trim().length === 0
) {
  throw new Error(
    "Invalid web/public/site.webmanifest: theme_color must be a non-empty string in a JSON object.",
  );
}

export const metadata: Metadata = {
  title: "FM SaveLens 24 — Local Player Database",
  description: "Explore the players, abilities and attributes in your Football Manager 2024 saves.",
  applicationName: "FM SaveLens 24",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/app-16.png", type: "image/png", sizes: "16x16" },
      { url: "/icons/app-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/icons/app-180.png", type: "image/png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: manifest.theme_color,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
