import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { Player } from "@/components/player/Player";
import { SetupNotice } from "@/components/SetupNotice";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Podblock", template: "%s · Podblock" },
  description: "A podcast player that finds the ads and skips them for you.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d11" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-card"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Logo />
            <div className="ml-auto w-full max-w-md">
              <Suspense>
                <SearchBox />
              </Suspense>
            </div>
          </div>
        </header>
        <SetupNotice />
        <main id="main" className="mx-auto max-w-6xl px-4 pb-48 pt-8 sm:px-6">
          {children}
        </main>
        <Player />
      </body>
    </html>
  );
}
