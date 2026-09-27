import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { StatusPage } from "@/components/StatusPage";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <StatusPage
      title="Podcast not found"
      actions={
        <>
          <BackButton />
          <Link href="/search" className={buttonStyles()}>
            Search for a show
          </Link>
        </>
      }
    >
      It may have been removed from the Podcast Index. Searching for it by name usually finds its new listing.
    </StatusPage>
  );
}
