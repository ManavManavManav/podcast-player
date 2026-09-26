import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { enabledSocialProviders } from "@/lib/server/auth";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return <AuthForm mode="signup" next="/" socialProviders={enabledSocialProviders} />;
}
