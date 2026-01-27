import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

/* Rate Limiting */
const rateLimitMap = new Map()
const RATE_LIMIT_WINDOW = 60 * 1000 
const MAX_REQUESTS = 5 

function checkRateLimit(ip) {
  const now = Date.now()
  const userRequests = rateLimitMap.get(ip) || []

  
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW)

  if (recentRequests.length >= MAX_REQUESTS) {
    return false 
  }


  recentRequests.push(now)
  rateLimitMap.set(ip, recentRequests)

  
  if (rateLimitMap.size > 1000) {
    const oldestAllowed = now - RATE_LIMIT_WINDOW
    for (const [key, timestamps] of rateLimitMap.entries()) {
      if (timestamps.every(t => t < oldestAllowed)) {
        rateLimitMap.delete(key)
      }
    }
  }

  return true
}


const DISPOSABLE_DOMAINS = [
  'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwaway.email',
  'mailinator.com', 'maildrop.cc', 'temp-mail.org', 'getnada.com',
  'trashmail.com', 'yopmail.com', 'fakeinbox.com', 'sharklasers.com'
]

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  return DISPOSABLE_DOMAINS.includes(domain)
}

/**
 * 
 *
 * @param {Object} req - Request 
 * @param {Object} res - Response 
 */
export default async function handler(req, res) {

  
  res.setHeader('Access-Control-Allow-Origin', '*') 
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')


  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

 
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are accepted'
    })
  }

  
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
             req.headers['x-real-ip'] ||
             req.connection?.remoteAddress ||
             'unknown'

  if (!checkRateLimit(ip)) {
    console.log('⚠️ Rate limit exceeded for IP:', ip)
    return res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait a minute before trying again. Maximum 5 requests per minute.'
    })
  }

  
  const { email } = req.body

  console.log('📥 Received waitlist request for:', email, 'from IP:', ip)

 
  if (!email) {
    return res.status(400).json({
      error: 'Email is required',
      message: 'Please provide an email address'
    })
  }

  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      error: 'Invalid email',
      message: 'Please provide a valid email address'
    })
  }

  
  if (isDisposableEmail(email)) {
    console.log('⚠️ Disposable email detected:', email)
    return res.status(400).json({
      error: 'Invalid email',
      message: 'Temporary email addresses are not allowed. Please use a permanent email.'
    })
  }

  
  try {
    
    const { data, error } = await supabase
      .from('waitlist')           
      .insert([{                  
        email: email.toLowerCase().trim(), 
        created_at: new Date(),   
        source: 'website'         
      }])
      .select()                   

    
    if (error) {
      console.error('❌ Supabase error:', error)

      
      if (error.code === '23505') { 
        return res.status(400).json({
          error: 'Email already registered',
          message: 'This email is already on the waitlist'
        })
      }

      
      throw error
    }

    
    console.log('✅ Email saved to waitlist:', email)

    return res.status(200).json({
      success: true,
      message: 'Successfully joined the waitlist!',
      data: data[0] 
    })

  } catch (error) {
    
    console.error('💥 Unexpected error:', error)

    return res.status(500).json({
      error: 'Server error',
      message: 'Failed to join waitlist. Please try again later.'
    })
  }
}
