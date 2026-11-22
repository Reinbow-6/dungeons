import {
  createSupabaseServerClient,
  isSupabaseEnvConfigured,
} from "@/lib/supabase/server";

export type AccessTier = "whitelisted" | "guest";

export interface RequestAccess {
  authenticated: boolean;
  whitelisted: boolean;
  email: string | null;
  userId: string | null;
  tier: AccessTier;
  supabaseConfigured: boolean;
}

export function parseWhitelistEmails(raw?: string): Set<string> {
  const emails = new Set<string>();
  if (!raw) {
    return emails;
  }

  for (const part of raw.split(/[,;\r\n]+/)) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length > 0) {
      emails.add(normalized);
    }
  }

  return emails;
}

export function isEmailWhitelisted(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!email) {
    return false;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const allowedEmails = parseWhitelistEmails(env.AUTH_WHITELIST_EMAILS);
  return allowedEmails.has(normalized);
}

function createGuestAccess(supabaseConfigured: boolean): RequestAccess {
  return {
    authenticated: false,
    whitelisted: false,
    email: null,
    userId: null,
    tier: "guest",
    supabaseConfigured,
  };
}

export async function resolveRequestAccess(
  req?: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<RequestAccess> {
  void req;
  const supabaseConfigured = isSupabaseEnvConfigured(env);

  try {
    const supabase = await createSupabaseServerClient(env);
    if (!supabase) {
      return createGuestAccess(supabaseConfigured);
    }

    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) {
      return createGuestAccess(true);
    }

    const claims = data.claims;
    const userId =
      typeof claims.sub === "string" && claims.sub.trim().length > 0
        ? claims.sub.trim()
        : null;
    const isAnonymous = claims.is_anonymous === true;
    const role = typeof claims.role === "string" ? claims.role : undefined;

    if (!userId || isAnonymous || role === "anon") {
      return createGuestAccess(true);
    }

    const email =
      typeof claims.email === "string" && claims.email.trim().length > 0
        ? claims.email.trim().toLowerCase()
        : null;
    const whitelisted = isEmailWhitelisted(email, env);

    return {
      authenticated: true,
      whitelisted,
      email,
      userId,
      tier: whitelisted ? "whitelisted" : "guest",
      supabaseConfigured: true,
    };
  } catch {
    return createGuestAccess(supabaseConfigured);
  }
}
