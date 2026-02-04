import { describe, it, expect } from 'vitest';
import { validateRobotData } from '../scripts/marketplace/utils/validation.js';

describe('validateRobotData', () => {
  const validData = {
    name: 'Test Robot',
    description: 'A test delivery robot',
    contact: 'test@example.com',
    category: 'delivery',
    price: '10',
    priceUnit: 'task'
  };

  it('should accept valid robot data', () => {
    const result = validateRobotData(validData);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.name).toBe('Test Robot');
  });

  it('should reject missing name', () => {
    const result = validateRobotData({ ...validData, name: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('name');
  });

  it('should reject missing description', () => {
    const result = validateRobotData({ ...validData, description: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Description');
  });

  it('should reject missing contact', () => {
    const result = validateRobotData({ ...validData, contact: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Contact');
  });

  it('should reject name exceeding 60 characters', () => {
    const longName = 'a'.repeat(61);
    const result = validateRobotData({ ...validData, name: longName });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('60');
  });

  it('should reject description exceeding 500 characters', () => {
    const longDescription = 'a'.repeat(501);
    const result = validateRobotData({ ...validData, description: longDescription });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
  });

  it('should normalize whitespace in text fields', () => {
    const result = validateRobotData({
      ...validData,
      name: '  Test   Robot  ',
      description: 'Multiple   spaces   here'
    });
    expect(result.valid).toBe(true);
    expect(result.data.name).toBe('Test Robot');
    expect(result.data.description).toBe('Multiple spaces here');
  });

  it('should handle null/undefined fields gracefully', () => {
    const result = validateRobotData({
      ...validData,
      speed: null,
      payload: undefined
    });
    expect(result.valid).toBe(true);
    expect(result.data.speed).toBe('');
    expect(result.data.payload).toBe('');
  });
});
