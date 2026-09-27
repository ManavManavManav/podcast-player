import { LogoMark } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark className="size-11" />
          <p className="font-serif text-3xl tracking-heading">Podcasts, minus the ads.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
