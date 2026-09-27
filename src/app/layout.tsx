import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
// Headlines and titles: an editorial serif over the Geist interface text.
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
// The Stage (full-window Now Playing): an uppercase grotesk, after physicsofbeauty.art.
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Podblock", template: "%s · Podblock" },
  description: "A podcast player that finds the ads and skips them for you.",
};

export const viewport: Viewport = {
  // Lets the player bar sit clear of the iPhone home indicator (env(safe-area-inset-*)).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${grotesk.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
