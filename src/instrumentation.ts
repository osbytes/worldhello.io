/** Next.js server startup hook — enforce production env before serving traffic. */
export async function register() {
  const { validateProductionEnv } = await import("@/lib/env");
  validateProductionEnv();
}
