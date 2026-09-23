"use client";

import { Headphones } from "lucide-react";
import { useState } from "react";

/**
 * Podcast artwork. Feeds point at arbitrary hosts, so this uses a plain <img>
 * (next/image would need every host allow-listed) with a fallback for the
 * many feeds whose artwork 404s.
 */
export function Artwork({
  src,
  alt,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`grid place-items-center bg-linear-to-br from-accent-soft to-surface-2 text-accent ${className}`}
        role="img"
        aria-label={alt}
      >
        <Headphones className="size-1/3" aria-hidden="true" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`bg-surface-2 object-cover ${className}`}
    />
  );
}
