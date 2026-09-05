import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FM SaveLens 24 — Local Player Database",
  description: "Explore the players, abilities and attributes in your Football Manager 2024 saves.",
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
