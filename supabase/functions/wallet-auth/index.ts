import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { decode as decodeBase58 } from "https://deno.land/std@0.168.0/encoding/base58.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { wallet, signature, message, nonce } = await req.json();

    if (!wallet || !signature || !message || !nonce) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: wallet, signature, message, nonce" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!message.includes(nonce)) {
      return new Response(
        JSON.stringify({ error: "Invalid message: nonce mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
