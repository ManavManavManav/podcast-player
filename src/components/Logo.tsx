import Link from "next/link";

export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-accent" />
      {/* A play triangle whose tip "jumps" ahead: playback that skips. */}
      <path d="M11 9.5v13l9-6.5-9-6.5Z" className="fill-accent-text" />
      <rect x="21.5" y="9.5" width="2.5" height="13" rx="1.25" className="fill-accent-text" opacity="0.75" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg" aria-label="Podblock home">
      <LogoMark />
      <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Podblock</span>
    </Link>
  );
}
