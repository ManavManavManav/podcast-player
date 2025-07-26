// components/Layout.tsx
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 px-6 py-8 overflow-y-auto">{children}</main>
    </div>
  );
}
