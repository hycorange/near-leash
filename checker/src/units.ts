/** "0.05" NEAR -> yoctoNEAR string, exact (no floating point). */
export function toYocto(near: string): string {
  if (!/^\d+(\.\d{1,24})?$/.test(near)) throw new Error(`bad NEAR amount: ${near}`);
  const [w, f = ''] = near.split('.');
  return (BigInt(w) * 10n ** 24n + BigInt(f.padEnd(24, '0'))).toString();
}
