import App from "@/components/App";

// Short link form: worldhello.io/<code> behaves like /?ref=<code>.
export default async function CodeLanding({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <App refCode={code} />;
}
