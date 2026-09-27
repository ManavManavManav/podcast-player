import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { enabledSocialProviders, hasAdmin } from "@/lib/server/auth";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  // Until the admin exists, only the admin can sign up, and that takes the setup code.
  const setupCode = !(await hasAdmin());
  return <AuthForm mode="signup" next="/" socialProviders={enabledSocialProviders} setupCode={setupCode} />;
}
