import { describe, it, expect } from 'vitest';
import {
  isValidSolanaAddress,
  validateEmail,
  compactRobotIdForSeed,
  isOriginAllowed
} from '../scripts/utils/validation.js';

describe('isValidSolanaAddress', () => {
  it('should accept valid Solana addresses', () => {
    // Example valid addresses (Base58, 32-44 chars)
    expect(isValidSolanaAddress('7B1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxcC')).toBe(true);
    expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
  });

  it('should reject invalid addresses', () => {
    expect(isValidSolanaAddress('')).toBe(false);
    expect(isValidSolanaAddress(null)).toBe(false);
    expect(isValidSolanaAddress(undefined)).toBe(false);
    expect(isValidSolanaAddress('too-short')).toBe(false);
    expect(isValidSolanaAddress('contains-invalid-char-0OIl')).toBe(false);
    // Too long
    expect(isValidSolanaAddress('a'.repeat(50))).toBe(false);
  });

  it('should reject addresses with invalid Base58 characters (0, O, I, l)', () => {
    // These characters are not in Base58 alphabet
    expect(isValidSolanaAddress('0B1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxc')).toBe(false);
    expect(isValidSolanaAddress('OB1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxc')).toBe(false);
    expect(isValidSolanaAddress('IB1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxc')).toBe(false);
    expect(isValidSolanaAddress('lB1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxc')).toBe(false);
  });
});

describe('validateEmail', () => {
  it('should accept valid emails', () => {
    const result = validateEmail('test@example.com');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('test@example.com');
  });

  it('should normalize email to lowercase', () => {
    const result = validateEmail('Test@EXAMPLE.COM');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('test@example.com');
  });

  it('should trim whitespace', () => {
    const result = validateEmail('  test@example.com  ');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('test@example.com');
  });

  it('should reject invalid formats', () => {
    expect(validateEmail('invalid').valid).toBe(false);
    expect(validateEmail('missing@domain').valid).toBe(false);
    expect(validateEmail('@nodomain.com').valid).toBe(false);
    expect(validateEmail('spaces in@email.com').valid).toBe(false);
  });

  it('should reject empty/null values', () => {
    expect(validateEmail('').valid).toBe(false);
    expect(validateEmail(null).valid).toBe(false);
    expect(validateEmail(undefined).valid).toBe(false);
  });

  it('should reject disposable email domains', () => {
    expect(validateEmail('test@tempmail.com').valid).toBe(false);
    expect(validateEmail('test@mailinator.com').valid).toBe(false);
    expect(validateEmail('test@yopmail.com').valid).toBe(false);
  });

  it('should reject emails exceeding max length', () => {
    const longEmail = 'a'.repeat(250) + '@test.com';
    expect(validateEmail(longEmail).valid).toBe(false);
  });
});

describe('compactRobotIdForSeed', () => {
  it('should return short IDs unchanged', () => {
    expect(compactRobotIdForSeed('robot123')).toBe('robot123');
  });

  it('should remove dashes from UUIDs', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = compactRobotIdForSeed(uuid);
    expect(result).not.toContain('-');
    expect(result).toBe('a1b2c3d4e5f67890abcdef1234567890');
  });

  it('should truncate to 32 characters max', () => {
    const longId = 'a'.repeat(40);
    const result = compactRobotIdForSeed(longId);
    expect(result.length).toBe(32);
  });

  it('should handle UUID format correctly (36 chars -> 32 after removing dashes)', () => {
    const uuid = '12345678-1234-1234-1234-123456789012';
    const result = compactRobotIdForSeed(uuid);
    // UUID without dashes is exactly 32 chars
    expect(result.length).toBe(32);
    expect(result).toBe('12345678123412341234123456789012');
  });

  it('should throw on empty input', () => {
    expect(() => compactRobotIdForSeed('')).toThrow('Robot ID is missing');
    expect(() => compactRobotIdForSeed(null)).toThrow('Robot ID is missing');
  });

  it('should trim whitespace', () => {
    expect(compactRobotIdForSeed('  robot123  ')).toBe('robot123');
  });
});

describe('isOriginAllowed', () => {
  const whitelist = [
    'https://roborio.xyz',
    'https://www.roborio.xyz',
    /^https:\/\/roborio-.*\.vercel\.app$/,
    'http://localhost:3000'
  ];

  it('should allow exact matches', () => {
    expect(isOriginAllowed('https://roborio.xyz', whitelist)).toBe(true);
    expect(isOriginAllowed('https://www.roborio.xyz', whitelist)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', whitelist)).toBe(true);
  });

  it('should allow regex matches', () => {
    expect(isOriginAllowed('https://roborio-abc123.vercel.app', whitelist)).toBe(true);
    expect(isOriginAllowed('https://roborio-preview-123.vercel.app', whitelist)).toBe(true);
  });

  it('should reject non-matching origins', () => {
    expect(isOriginAllowed('https://malicious.com', whitelist)).toBe(false);
    expect(isOriginAllowed('https://fake-roborio.xyz', whitelist)).toBe(false);
    expect(isOriginAllowed('http://roborio.xyz', whitelist)).toBe(false); // http vs https
  });

  it('should reject empty/null origins', () => {
    expect(isOriginAllowed('', whitelist)).toBe(false);
    expect(isOriginAllowed(null, whitelist)).toBe(false);
    expect(isOriginAllowed(undefined, whitelist)).toBe(false);
  });
});
