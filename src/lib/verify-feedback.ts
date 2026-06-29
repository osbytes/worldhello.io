export const VERIFY_FAILURE_REASONS = [
  "expired",
  "used",
  "invalid",
  "wrong_device",
  "no_session",
  "error",
] as const;

export type VerifyFailureReason = (typeof VERIFY_FAILURE_REASONS)[number];

export function parseVerifyFailureReason(value: string | undefined): VerifyFailureReason | null {
  if (!value || value === "1") return null;
  if (value === "failed") return "error";
  return VERIFY_FAILURE_REASONS.includes(value as VerifyFailureReason)
    ? (value as VerifyFailureReason)
    : null;
}

export function messageForVerifyFailure(reason: VerifyFailureReason): string {
  switch (reason) {
    case "expired":
      return "This link expired — verification links last 30 minutes. Request a new one below.";
    case "used":
      return "This link was already used — each link works once. Request a new one below.";
    case "invalid":
      return "This link is invalid — it may be incomplete or corrupted. Request a new one below.";
    case "wrong_device":
      return "Wrong browser — open the link on the same device where you requested the verification email.";
    case "no_session":
      return "No device session found — open the link in the same browser where you requested the email.";
    case "error":
      return "Something went wrong during verification. Request a new link below.";
  }
}
