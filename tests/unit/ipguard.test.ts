import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The game uses only original names and assets. This guard keeps trademarked product,
 * creature and item names out of shipped sources.
 */
const BANNED = /\b(minecraft|mojang|creeper|enderman|endermen|redstone|netherite|ghast|piglin|herobrine)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('ip guard', () => {
  it('shipped sources contain no trademarked names', () => {
    const files = [...walk('src'), 'index.html', ...(existsSync('public') ? walk('public') : [])].filter(
      (f) => existsSync(f),
    );
    const offenders = files.filter((f) => BANNED.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
