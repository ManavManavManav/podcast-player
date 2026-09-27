export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading podcast">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="skeleton size-40 rounded-card sm:size-52" />
        <div className="w-full max-w-md space-y-3">
          <div className="skeleton h-9 w-3/4 rounded-lg" />
          <div className="skeleton h-4 w-1/3 rounded" />
        </div>
      </div>
      <div className="space-y-2 rounded-3xl bg-surface p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
