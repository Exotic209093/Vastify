import { describe, test, expect } from 'bun:test';
import { usd, bytes, relativeTime, compactNumber } from '../src/lib/format.ts';

describe('usd', () => {
  test('whole-dollar formatting for amounts >= 100', () => {
    expect(usd(1234)).toBe('$1,234');
    expect(usd(100)).toBe('$100');
    expect(usd(99_999)).toBe('$99,999');
  });

  test('two-decimal formatting for amounts < 100', () => {
    expect(usd(4.98)).toBe('$4.98');
    expect(usd(0.12)).toBe('$0.12');
    expect(usd(99.49)).toBe('$99.49');
  });

  test('handles zero and negatives', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(-50)).toBe('-$50.00');
    expect(usd(-1234)).toBe('-$1,234');
  });
});

describe('bytes', () => {
  test('formats bytes through TB', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1024)).toBe('1.0 KB');
    expect(bytes(1024 * 1024)).toBe('1.0 MB');
    expect(bytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(bytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
  });

  test('one decimal under 10 of unit, zero decimals at/above 10', () => {
    expect(bytes(2 * 1024)).toBe('2.0 KB');
    expect(bytes(15 * 1024)).toBe('15 KB');
    expect(bytes(150 * 1024)).toBe('150 KB');
  });

  test('non-finite returns em-dash placeholder', () => {
    expect(bytes(Number.POSITIVE_INFINITY)).toBe('—');
    expect(bytes(Number.NaN)).toBe('—');
  });
});

describe('relativeTime', () => {
  test('< 1s reads as "just now"', () => {
    expect(relativeTime(Date.now())).toBe('just now');
    expect(relativeTime(Date.now() - 500)).toBe('just now');
  });

  test('seconds, minutes, hours, days', () => {
    const now = Date.now();
    expect(relativeTime(now - 5_000)).toBe('5s ago');
    expect(relativeTime(now - 90_000)).toBe('1m ago');
    expect(relativeTime(now - 7_200_000)).toBe('2h ago');
    expect(relativeTime(now - 3 * 86_400_000)).toBe('3d ago');
  });
});

describe('compactNumber', () => {
  test('produces SI-suffixed compact form', () => {
    expect(compactNumber(1_234)).toBe('1.2K');
    expect(compactNumber(2_500_000)).toBe('2.5M');
    expect(compactNumber(42)).toBe('42');
  });
});
