import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { SetupNotice } from "@/components/SetupNotice";
import { UserMenu } from "@/components/UserMenu";
import { PlayBurst } from "@/components/player/PlayBurst";
import { Player } from "@/components/player/Player";
import { currentUser } from "@/lib/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  // The proxy already redirects when there's no session cookie; this also
  // catches expired or revoked sessions.
  if (!user) redirect("/login");
  if (!user.approved) redirect("/pending");

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-card"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-6xl items-center gap-3 px-4 sm:gap-8 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-body md:flex">
            <Link href="/" className="font-medium hover:text-muted">
              Discover
            </Link>
            {user.role === "admin" && (
              <Link href="/admin" className="text-muted hover:text-text">
                Users
              </Link>
            )}
          </nav>
          <div className="ml-auto w-full max-w-xs">
            <Suspense>
              <SearchBox />
            </Suspense>
          </div>
          <UserMenu name={user.name} email={user.email} image={user.image ?? null} isAdmin={user.role === "admin"} />
        </div>
      </header>
      <SetupNotice isAdmin={user.role === "admin"} />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-48 pt-6 sm:px-6">
        {children}
      </main>
      <Player userId={user.id} />
      <PlayBurst />
    </>
  );
}
