import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Podcast not found</h1>
      <p className="mt-2 text-muted">It may have been removed from the Podcast Index.</p>
      <Link href="/" className={`mt-6 ${buttonStyles()}`}>
        Back home
      </Link>
    </div>
  );
}
