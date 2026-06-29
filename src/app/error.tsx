"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
      <p className="text-sm text-zinc-400">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-sky-300"
      >
        Try again
      </button>
    </main>
  );
}
