import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getCurrentUser } from "@/lib/auth";

function HomeFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-sm text-zinc-500">
      Abriendo el núcleo…
    </div>
  );
}

async function ProtectedHome() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <WorkspaceShell userEmail={user.email} />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <ProtectedHome />
    </Suspense>
  );
}