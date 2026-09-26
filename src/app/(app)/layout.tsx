import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { SetupNotice } from "@/components/SetupNotice";
import { UserMenu } from "@/components/UserMenu";
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
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Logo />
          <div className="ml-auto w-full max-w-md">
            <Suspense>
              <SearchBox />
            </Suspense>
          </div>
          <UserMenu name={user.name} email={user.email} image={user.image ?? null} isAdmin={user.role === "admin"} />
        </div>
      </header>
      <SetupNotice isAdmin={user.role === "admin"} />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-48 pt-8 sm:px-6">
        {children}
      </main>
      <Player userId={user.id} />
    </>
  );
}
