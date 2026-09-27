import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
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
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:bg-text focus:px-3 focus:py-2 focus:uppercase focus:text-bg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-6xl items-center gap-3 px-4 sm:gap-8 sm:px-6">
          <Logo />
          <NavLinks isAdmin={user.role === "admin"} />
          <div className="ml-auto w-full max-w-xs">
            <Suspense>
              <SearchBox />
            </Suspense>
          </div>
          <UserMenu name={user.name} email={user.email} image={user.image ?? null} isAdmin={user.role === "admin"} />
        </div>
      </header>
      <SetupNotice isAdmin={user.role === "admin"} />
      {/* Room for the player bar, whose height <Player> publishes as --player-space. */}
      <main id="main" className="mx-auto max-w-6xl px-4 pb-[calc(var(--player-space,0px)+3rem)] pt-6 sm:px-6">
        {children}
      </main>
      <Player userId={user.id} />
      <PlayBurst />
    </>
  );
}
