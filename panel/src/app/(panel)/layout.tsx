import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import Shell from "@/components/Shell";

export const dynamic = "force-dynamic";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = getServerSession();
  if (!session?.mfa) {
    redirect("/login");
  }
  return <Shell>{children}</Shell>;
}