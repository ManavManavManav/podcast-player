import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { StatusPage } from "@/components/StatusPage";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <StatusPage
      title="Page not found"
      actions={
        <>
          <BackButton />
          <Link href="/" className={buttonStyles()}>
            Home
          </Link>
        </>
      }
    >
      There&apos;s nothing at this address. It may have moved, or the link may be mistyped.
    </StatusPage>
  );
}
