import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890" for SHA-1.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw6ytboi======').toString()).toBe('foobar');
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(() => base32Decode('1')).toThrow();
  });
});

describe('hotp / totp (RFC 4226 + RFC 6238 test vectors)', () => {
  it('matches RFC 4226 HOTP values', () => {
    const key = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 3, 9].map((c) => hotp(key, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '520489',
    ]);
  });

  it('matches RFC 6238 SHA-1 values (8 digits)', () => {
    const cases: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of cases) expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code);
  });
});

describe('verifyTotp', () => {
  const at = 1_700_000_000_000;
  it('accepts the current code and one step of drift, returning the matched step', () => {
    const step = Math.floor(at / 30_000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at), at)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 30_000), at)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 30_000), at)).toBe(step + 1);
  });

  it('rejects stale codes and malformed input', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 90_000), at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBeNull();
    const code = totp(RFC_SECRET, at);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, at)).not.toBeNull();
  });

  it('builds an otpauth URI', () => {
    expect(otpauthUri('ABC', 'ada@example.com')).toBe(
      'otpauth://totp/Backstages%3Aada%40example.com?secret=ABC&issuer=Backstages&algorithm=SHA1&digits=6&period=30',
    );
  });
});
