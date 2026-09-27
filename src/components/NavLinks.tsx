"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The header's section links, with the current one marked. */
export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Discover", current: pathname === "/" },
    ...(isAdmin ? [{ href: "/admin", label: "Users", current: pathname.startsWith("/admin") }] : []),
  ];
  return (
    <nav className="hidden items-center gap-7 text-body md:flex">
      {links.map(({ href, label, current }) => (
        <Link
          key={href}
          href={href}
          aria-current={current ? "page" : undefined}
          className={`relative py-1 transition-colors ${
            current
              ? "font-medium text-text after:absolute after:-bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-text"
              : "text-muted hover:text-text"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
