import App from "@/components/App";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; link?: string; verified?: string }>;
}) {
  const { ref, link, verified } = await searchParams;
  return (
    <App
      refCode={ref ?? null}
      linkCode={link ?? null}
      emailVerified={verified === "1"}
    />
  );
}
