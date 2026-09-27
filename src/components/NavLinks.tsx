"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonStyles } from "@/components/ui/Button";

/** The header's section links, with the current one marked. */
export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Discover", current: pathname === "/" },
    ...(isAdmin ? [{ href: "/admin", label: "Users", current: pathname.startsWith("/admin") }] : []),
  ];
  return (
    <nav className="hidden items-center gap-2 md:flex">
      {links.map(({ href, label, current }) => (
        <Link
          key={href}
          href={href}
          aria-current={current ? "page" : undefined}
          className={buttonStyles({ variant: "word" })}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
