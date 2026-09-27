import { LogoMark } from "@/components/Logo";

/** Not-found and error pages: the logo, a display heading, a line of explanation and actions. */
export function StatusPage({
  title,
  children,
  actions,
  footnote,
}: {
  title: string;
  children?: React.ReactNode;
  actions: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center sm:py-28">
      <LogoMark className="size-10 opacity-90" />
      <h1 className="mt-7 font-serif text-4xl leading-tight tracking-display text-balance sm:text-5xl">{title}</h1>
      {children && <p className="mt-3 text-pretty text-muted">{children}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
      {footnote && <p className="mt-8 font-mono text-xs text-faint">{footnote}</p>}
    </div>
  );
}
