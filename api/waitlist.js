import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ============ Environment validation ============
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM
const WAITLIST_BASE_URL = process.env.WAITLIST_BASE_URL || 'https://roborio.xyz'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[Waitlist] Missing SUPABASE_URL or SUPABASE_ANON_KEY')
}

const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null

// ============ CORS whitelist ============
const ALLOWED_ORIGINS = [
  'https://roborio.xyz',
  'https://www.roborio.xyz',
  /^https:\/\/roborio-.*\.vercel\.app$/,  // Vercel preview deployments
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
]

function isOriginAllowed(origin) {
  if (!origin) return false
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin)
    }
    return allowed === origin
  })
}

// ============ Rate Limiting ============
const rateLimitMap = new Map()
const RATE_LIMIT_WINDOW = 60 * 1000
const MAX_REQUESTS = 5
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes
let lastCleanup = Date.now()

/**
 * Parse client IP from headers
 * @param {Object} req
 * @returns {string}
 */
function getClientIP(req) {
  // x-forwarded-for can be comma-separated list
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const firstIP = forwarded.split(',')[0].trim()
    // Normalize IPv6-mapped IPv4 (::ffff:127.0.0.1 -> 127.0.0.1)
    return firstIP.replace(/^::ffff:/, '')
  }

  const realIP = req.headers['x-real-ip']
  if (realIP) {
    return realIP.trim().replace(/^::ffff:/, '')
  }

  return req.connection?.remoteAddress?.replace(/^::ffff:/, '') || 'unknown'
}

/**
 * Cleanup old rate limit entries (lazy, on interval)
 */
function cleanupRateLimitMap() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return

  lastCleanup = now
  const oldestAllowed = now - RATE_LIMIT_WINDOW

  for (const [key, timestamps] of rateLimitMap.entries()) {
    if (timestamps.every(t => t < oldestAllowed)) {
      rateLimitMap.delete(key)
    }
  }
}

/**
 * Check rate limit for IP
 * @param {string} ip
 * @returns {boolean}
 */
function checkRateLimit(ip) {
  cleanupRateLimitMap()

  const now = Date.now()
  const userRequests = rateLimitMap.get(ip) || []
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW)

  if (recentRequests.length >= MAX_REQUESTS) {
    return false
  }

  recentRequests.push(now)
  rateLimitMap.set(ip, recentRequests)
  return true
}

// ============ Email validation ============
const DISPOSABLE_DOMAINS = [
  'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwaway.email',
  'mailinator.com', 'maildrop.cc', 'temp-mail.org', 'getnada.com',
  'trashmail.com', 'yopmail.com', 'fakeinbox.com', 'sharklasers.com'
]

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000

/**
 * Normalize and validate email
 * @param {string} email
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' }
  }

  const normalized = String(email).trim().toLowerCase()

  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Invalid email format' }
  }

  const domain = normalized.split('@')[1]
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return { valid: false, error: 'Temporary email addresses are not allowed' }
  }

  return { valid: true, normalized }
}

function createConfirmToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function getBaseUrl(origin) {
  if (origin && isOriginAllowed(origin)) return origin
  return WAITLIST_BASE_URL
}

async function sendConfirmationEmail({ email, token, origin }) {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    console.warn('[Waitlist] Resend not configured', {
      hasResendKey: !!RESEND_API_KEY,
      resendFrom: RESEND_FROM || null
    })
    return { sent: false, reason: 'missing_email_provider' }
  }

  const baseUrl = getBaseUrl(origin)
  const confirmUrl = `${baseUrl}/api/waitlist/confirm?token=${encodeURIComponent(token)}`
  console.info('[Waitlist] Sending confirmation email', {
    to: email,
    from: RESEND_FROM,
    baseUrl
  })
  const subject = 'Confirm your Roborio waitlist signup'
  const text = `Confirm your email to join the Roborio waitlist:\n\n${confirmUrl}\n\nIf you did not request this, you can ignore this email.`
  const html = `
    <div style="font-family:Arial, sans-serif; line-height:1.6;">
      <h2>Confirm your Roborio waitlist signup</h2>
      <p>Click the button below to confirm your email:</p>
      <p><a href="${confirmUrl}" style="display:inline-block;padding:10px 16px;background:#10b981;color:#000;text-decoration:none;border-radius:8px;font-weight:600;">Confirm email</a></p>
      <p>Or copy and paste this link:</p>
      <p><a href="${confirmUrl}">${confirmUrl}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [email],
      subject,
      text,
      html
    })
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '')
    throw new Error(`Email send failed: ${resp.status} ${errorText}`)
  }

  return { sent: true }
}

// ============ Response helpers ============
function setSecurityHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function setCorsHeaders(res, origin) {
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Vary', 'Origin')
}

// ============ Handler ============
/**
 * Waitlist API handler
 * @param {Object} req - Request
 * @param {Object} res - Response
 */
export default async function handler(req, res) {
  const origin = req.headers.origin

  // Set headers early
  setCorsHeaders(res, origin)
  setSecurityHeaders(res)

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  // Method check
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are accepted'
    })
  }

  // Environment check
  if (!supabase) {
    console.error('[Waitlist] Supabase client not initialized - missing env vars')
    return res.status(500).json({
      error: 'Server configuration error',
      message: 'Service temporarily unavailable. Please try again later.'
    })
  }

  // Rate limiting
  const ip = getClientIP(req)
  if (!checkRateLimit(ip)) {
    console.warn('[Waitlist] Rate limit exceeded')
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait a minute before trying again.'
    })
  }

  // Email validation (normalize BEFORE any checks)
  const { email } = req.body || {}
  const validation = validateEmail(email)

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid email',
      message: validation.error
    })
  }

  // Insert to database
  try {
    console.info('[Waitlist] Email config', {
      hasResendKey: !!RESEND_API_KEY,
      resendFrom: RESEND_FROM || null,
      baseUrl: WAITLIST_BASE_URL || null
    })

    const now = new Date()
    const token = createConfirmToken()
    const tokenHash = hashToken(token)
    const confirmExpiresAt = new Date(now.getTime() + CONFIRM_TTL_MS).toISOString()

    const { data: existing, error: lookupError } = await supabase
      .from('waitlist')
      .select('id, status, last_sent_at')
      .eq('email', validation.normalized)
      .maybeSingle()

    if (lookupError) {
      console.error('[Waitlist] Lookup error:', lookupError.code)
      throw lookupError
    }

    if (existing?.status === 'confirmed') {
      return res.status(409).json({
        error: 'Email already registered',
        message: 'This email is already confirmed on the waitlist'
      })
    }

    if (existing?.id) {
      const lastSent = existing.last_sent_at ? new Date(existing.last_sent_at).getTime() : 0
      if (lastSent && now.getTime() - lastSent < RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Please wait a minute before requesting another confirmation email.'
        })
      }

      const { error: updateError } = await supabase
        .from('waitlist')
        .update({
          confirm_token_hash: tokenHash,
          confirm_expires_at: confirmExpiresAt,
          last_sent_at: now.toISOString(),
          status: 'pending',
          source: 'website'
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('[Waitlist] Update error:', updateError.code)
        throw updateError
      }
    } else {
      const { error: insertError } = await supabase
        .from('waitlist')
        .insert([{
          email: validation.normalized,
          created_at: now.toISOString(),
          source: 'website',
          status: 'pending',
          confirm_token_hash: tokenHash,
          confirm_expires_at: confirmExpiresAt,
          last_sent_at: now.toISOString()
        }])

      if (insertError) {
        if (insertError.code === '23505') {
          return res.status(409).json({
            error: 'Email already registered',
            message: 'This email is already on the waitlist'
          })
        }
        console.error('[Waitlist] Database error:', insertError.code)
        throw insertError
      }
    }

    try {
      await sendConfirmationEmail({ email: validation.normalized, token, origin })
    } catch (emailError) {
      console.error('[Waitlist] Email error:', emailError.message)
      return res.status(202).json({
        success: true,
        message: 'We created your signup. Confirmation email could not be sent. Please try again later.'
      })
    }

    // Success - don't return any data from DB
    return res.status(200).json({
      success: true,
      message: 'Check your email to confirm your waitlist signup.'
    })

  } catch (error) {
    console.error('[Waitlist] Unexpected error:', error.message)
    return res.status(500).json({
      error: 'Server error',
      message: 'Failed to join waitlist. Please try again later.'
    })
  }
}
