import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getAuthStatus } from "@/app/api/auth/status/route";
import { GET as getAuthCallback } from "@/app/auth/callback/route";
import {
  isEmailWhitelisted,
  parseWhitelistEmails,
  resolveRequestAccess,
} from "@/lib/auth/whitelist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createSupabaseServerClient: vi.fn(actual.createSupabaseServerClient),
  };
});

const TEST_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseWhitelistEmails & isEmailWhitelisted", () => {
  it("parses comma, semicolon, and newline lists with trim and lowercase", () => {
    const parsed = parseWhitelistEmails(
      "  Alice@Example.COM, bob@example.org;\ncarol@dungeon.ar;\r\n  ALICE@example.com ; ",
    );

    expect(Array.from(parsed)).toEqual([
      "alice@example.com",
      "bob@example.org",
      "carol@dungeon.ar",
    ]);
    expect(parseWhitelistEmails(undefined).size).toBe(0);
    expect(parseWhitelistEmails("   ").size).toBe(0);
  });

  it("matches whitelisted emails case-insensitively and fails closed otherwise", () => {
    const env = {
      AUTH_WHITELIST_EMAILS: "Master@Dungeons.ar; player@guild.org",
    };

    expect(isEmailWhitelisted("master@dungeons.ar", env)).toBe(true);
    expect(isEmailWhitelisted("  PLAYER@GUILD.ORG  ", env)).toBe(true);
    expect(isEmailWhitelisted("intruder@dungeons.ar", env)).toBe(false);
    expect(isEmailWhitelisted("master@dungeons.ar.evil.com", env)).toBe(false);
    expect(isEmailWhitelisted(null, env)).toBe(false);
    expect(isEmailWhitelisted(undefined, env)).toBe(false);
    expect(isEmailWhitelisted("", env)).toBe(false);
    expect(isEmailWhitelisted("master@dungeons.ar", {})).toBe(false);
  });
});

describe("resolveRequestAccess", () => {
  it("falls back cleanly to guest when Supabase env vars are missing", async () => {
    const access = await resolveRequestAccess(
      new Request("http://localhost:3000/api/auth/status"),
      {},
    );

    expect(access).toEqual({
      authenticated: false,
      whitelisted: false,
      email: null,
      userId: null,
      tier: "guest",
      supabaseConfigured: false,
    });
  });

  it("falls back cleanly to guest outside Next.js cookies context (e.g. Vitest)", async () => {
    const access = await resolveRequestAccess(
      new Request("http://localhost:3000/api/auth/status"),
      {
        ...TEST_ENV,
        AUTH_WHITELIST_EMAILS: "dm@dungeons.ar",
      },
    );

    expect(access).toEqual({
      authenticated: false,
      whitelisted: false,
      email: null,
      userId: null,
      tier: "guest",
      supabaseConfigured: true,
    });
  });

  it("resolves whitelisted tier using verified JWT claims via getClaims()", async () => {
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: {
          sub: "user-123",
          email: "DM@Dungeons.ar",
          role: "authenticated",
          is_anonymous: false,
        },
      },
      error: null,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: { getClaims },
    } as never);

    const access = await resolveRequestAccess(undefined, {
      ...TEST_ENV,
      AUTH_WHITELIST_EMAILS: "dm@dungeons.ar",
    });

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(access).toEqual({
      authenticated: true,
      whitelisted: true,
      email: "dm@dungeons.ar",
      userId: "user-123",
      tier: "whitelisted",
      supabaseConfigured: true,
    });
  });

  it("keeps authenticated non-whitelisted users in guest tier and ignores user_metadata", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "user-456",
              role: "authenticated",
              // Never trust user_metadata.email if top-level email claim is absent
              user_metadata: { email: "dm@dungeons.ar" },
            },
          },
          error: null,
        }),
      },
    } as never);

    const access = await resolveRequestAccess(undefined, {
      ...TEST_ENV,
      AUTH_WHITELIST_EMAILS: "dm@dungeons.ar",
    });

    expect(access).toEqual({
      authenticated: true,
      whitelisted: false,
      email: null,
      userId: "user-456",
      tier: "guest",
      supabaseConfigured: true,
    });
  });

  it("rejects anonymous claims and getClaims errors safely", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              sub: "anon-789",
              email: "dm@dungeons.ar",
              role: "authenticated",
              is_anonymous: true,
            },
          },
          error: null,
        }),
      },
    } as never);

    const anonAccess = await resolveRequestAccess(undefined, {
      ...TEST_ENV,
      AUTH_WHITELIST_EMAILS: "dm@dungeons.ar",
    });
    expect(anonAccess.authenticated).toBe(false);
    expect(anonAccess.tier).toBe("guest");

    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: {
        getClaims: vi.fn().mockRejectedValue(new Error("JWKS failure")),
      },
    } as never);

    const failedAccess = await resolveRequestAccess(undefined, TEST_ENV);
    expect(failedAccess).toEqual({
      authenticated: false,
      whitelisted: false,
      email: null,
      userId: null,
      tier: "guest",
      supabaseConfigured: true,
    });
  });
});

describe("auth status & callback route handlers", () => {
  it("GET /api/auth/status returns no-store JSON and never leaks AUTH_WHITELIST_EMAILS", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(null);

    const response = await getAuthStatus(
      new Request("http://localhost:3000/api/auth/status"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bodyText = await response.text();
    const json = JSON.parse(bodyText) as Record<string, unknown>;
    expect(json.tier).toBe("guest");
    expect(json).not.toHaveProperty("AUTH_WHITELIST_EMAILS");
    expect(json).not.toHaveProperty("whitelist");
  });

  it("GET /auth/callback handles code, token_hash+type, and rejects unsafe next redirects", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession,
        verifyOtp,
      },
    } as never);

    const codeRes = await getAuthCallback(
      new Request("http://localhost:3000/auth/callback?code=pkce_123&next=//evil.com"),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce_123");
    expect(codeRes.status).toBe(307);
    expect(codeRes.headers.get("location")).toBe("http://localhost:3000/");

    const otpRes = await getAuthCallback(
      new Request(
        "http://localhost:3000/auth/callback?token_hash=tok_456&type=magiclink&next=/mesa",
      ),
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "tok_456",
      type: "magiclink",
    });
    expect(otpRes.status).toBe(307);
    expect(otpRes.headers.get("location")).toBe("http://localhost:3000/mesa");
  });
});
