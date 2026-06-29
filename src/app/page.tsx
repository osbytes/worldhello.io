import App from "@/components/App";
import { parseVerifyFailureReason } from "@/lib/verify-feedback";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; link?: string; verified?: string; verify?: string }>;
}) {
  const { ref, link, verified, verify } = await searchParams;
  return (
    <App
      refCode={ref ?? null}
      linkCode={link ?? null}
      emailVerified={verified === "1"}
      verifyFailureReason={parseVerifyFailureReason(verify)}
    />
  );
}
