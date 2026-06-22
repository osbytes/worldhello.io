import App from "@/components/App";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  return <App refCode={ref ?? null} />;
}
