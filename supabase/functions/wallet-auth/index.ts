import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { decode as decodeBase58 } from "https://deno.land/std@0.168.0/encoding/base58.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://roborio.xyz",
  "https://www.roborio.xyz",
  /^https:\/\/roborio-.*\.vercel\.app$/,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isOriginAllowed(origin: string) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((allowed) => {
    if (allowed instanceof RegExp) return allowed.test(origin);
    return allowed === origin;
  });
}

function buildCorsHeaders(origin: string) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (origin && isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ALLOWED_CLOCK_SKEW_MS = 2 * 60 * 1000; // 2 minutes

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

function extractFromMessage(message: string, label: string): string | null {
  const regex = new RegExp(`${label}:\\s*(.+)`);
  const match = message.match(regex);
  return match ? match[1].trim() : null;
}

serve(async (req) => {
  const originHeader = req.headers.get("origin") || "";
  const corsHeaders = buildCorsHeaders(originHeader);

  if (req.method === "OPTIONS") {
    if (originHeader && !isOriginAllowed(originHeader)) {
      return new Response("forbidden", { status: 403 });
    }
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { wallet, signature, message, nonce, timestamp, origin } = await req.json();

    if (!wallet || !signature || !message || !nonce || !timestamp) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: wallet, signature, message, nonce, timestamp" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const messageNonce = extractFromMessage(message, "Nonce");
    const messageTimestamp = extractFromMessage(message, "Timestamp");
    const messageOrigin = extractFromMessage(message, "Origin");

    if (!messageNonce || messageNonce !== nonce) {
      return new Response(
        JSON.stringify({ error: "Invalid message: nonce mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!messageTimestamp || Number.isNaN(Number(messageTimestamp)) || Number(messageTimestamp) !== Number(timestamp)) {
      return new Response(
        JSON.stringify({ error: "Invalid message: timestamp mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = Date.now();
    const ts = Number(timestamp);
    const maxAge = NONCE_TTL_MS + ALLOWED_CLOCK_SKEW_MS;
    if (Math.abs(now - ts) > maxAge) {
      return new Response(
        JSON.stringify({ error: "Invalid message: timestamp outside allowed window" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Enforce origin binding if available
    const reqOrigin = originHeader;
    if (reqOrigin && !isOriginAllowed(reqOrigin)) {
      return new Response(
        JSON.stringify({ error: "Invalid request origin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (messageOrigin && origin && messageOrigin !== origin) {
      return new Response(
        JSON.stringify({ error: "Invalid message: origin mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (reqOrigin && origin && reqOrigin !== origin) {
      return new Response(
        JSON.stringify({ error: "Invalid request origin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Replay protection (persistent)
    if (!supabase) {
      console.error("Supabase client not initialized (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiresAt = new Date(now + NONCE_TTL_MS).toISOString();
    const { error: insertError } = await supabase
      .from("auth_nonces")
      .insert({ nonce, wallet, expires_at: expiresAt });

    if (insertError) {
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "Nonce already used" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.error("Nonce insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Best-effort cleanup of expired nonces
    try {
      const cutoff = new Date(now - ALLOWED_CLOCK_SKEW_MS).toISOString();
      await supabase.from("auth_nonces").delete().lt("expires_at", cutoff);
    } catch (cleanupError) {
      console.warn("Nonce cleanup warning:", cleanupError?.message ?? cleanupError);
    }

    // Decode wallet public key (base58)
    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = decodeBase58(wallet);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid wallet address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Decode signature (base64 from frontend)
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid signature format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify signature
    const messageBytes = new TextEncoder().encode(message);
    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- ES256 JWT for Supabase ----
    const JWT_JWK = Deno.env.get("JWT_JWK");
    const JWT_KID = Deno.env.get("JWT_KID");

    if (!JWT_JWK || !JWT_KID) {
      console.error("JWT_JWK or JWT_KID is missing");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiresIn = 24 * 60 * 60; // 86400 seconds

    const jwk = JSON.parse(JWT_JWK);
    const privateKey = await jose.importJWK(jwk, "ES256");

    const token = await new jose.SignJWT({
      wallet,
      role: "authenticated",
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: JWT_KID })
      .setIssuedAt()
      .setExpirationTime("24h")
      .setSubject(wallet)
      .setAudience("authenticated")
      .setIssuer("supabase")
      .sign(privateKey);

    return new Response(
      JSON.stringify({ token, wallet, expiresIn }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error?.message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
