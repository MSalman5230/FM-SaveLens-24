import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: "#171e20",
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
