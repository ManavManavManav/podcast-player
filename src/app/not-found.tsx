import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className={`mt-6 ${buttonStyles()}`}>
        Back home
      </Link>
    </div>
  );
}
