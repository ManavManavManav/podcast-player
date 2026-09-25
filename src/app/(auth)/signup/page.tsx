import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { enabledSocialProviders, signupsAllowed } from "@/lib/server/auth";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  if (!signupsAllowed) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
        <h1 className="text-lg font-semibold">Sign-ups are closed</h1>
        <p className="mt-2 text-sm text-muted">Ask whoever runs this Podblock server to create an account for you.</p>
        <Link href="/login" className="mt-5 inline-block text-sm font-medium underline underline-offset-4 hover:text-muted">
          Back to sign in
        </Link>
      </div>
    );
  }
  return <AuthForm mode="signup" next="/" socialProviders={enabledSocialProviders} signupsAllowed />;
}
