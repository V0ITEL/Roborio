import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WAITLIST_BASE_URL = process.env.WAITLIST_BASE_URL || 'https://roborio.xyz'

const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function redirectToStatus(res, status) {
  const target = `${WAITLIST_BASE_URL}/#waitlist?status=${encodeURIComponent(status)}`
  res.statusCode = 302
  res.setHeader('Location', target)
  res.end()
}

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.end('Method not allowed')
  }

  if (!supabase) {
    res.statusCode = 500
    return res.end('Service unavailable')
  }

  const token = req.query?.token
  if (!token || typeof token !== 'string') {
    return redirectToStatus(res, 'invalid')
  }

  const tokenHash = hashToken(token)

  try {
    const { data, error } = await supabase
      .from('waitlist')
      .select('id, status, confirm_expires_at')
      .eq('confirm_token_hash', tokenHash)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (!data) {
      return redirectToStatus(res, 'invalid')
    }

    if (data.status === 'confirmed') {
      return redirectToStatus(res, 'confirmed')
    }

    const expiresAt = data.confirm_expires_at ? new Date(data.confirm_expires_at).getTime() : 0
    if (!expiresAt || Date.now() > expiresAt) {
      return redirectToStatus(res, 'expired')
    }

    const { error: updateError } = await supabase
      .from('waitlist')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirm_token_hash: null,
        confirm_expires_at: null
      })
      .eq('id', data.id)

    if (updateError) {
      throw updateError
    }

    return redirectToStatus(res, 'confirmed')
  } catch (err) {
    return redirectToStatus(res, 'error')
  }
}
