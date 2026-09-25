/**
 * The server's save rules (shared/saveRules.ts) must never refuse a save the game itself writes.
 * If they did, an honest player's progress would silently stay on their phone. So: real saves from
 * the real game, at the moments that change a save the most.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'vitest';
import { bootGame, installGameEnv, removeGameEnv, type GameHarness } from './helpers/game';
import { checkProgression, checkSaveIntegrity } from '../shared/saveRules';

let env: GameHarness;
beforeEach(() => {
  env = installGameEnv();
});
afterEach(() => removeGameEnv());

test('every save the game writes passes the server, and the progress between them too', async () => {
  const game = await bootGame(env, { continue: false });
  const saves = [game.snapshotSave()];
  const check = (label: string) => {
    const s = game.snapshotSave();
    const ok = checkSaveIntegrity(s, false);
    assert.ok(ok.ok, `${label}: ${JSON.stringify(ok)}`);
    const step = checkProgression(saves[saves.length - 1], s, 30_000);
    assert.ok(step.ok, `${label}: ${JSON.stringify(step)}`);
    saves.push(s);
  };
  check('new game');
  game.grantCore('core_ember');
  check('the tutorial core and its element');
  game.gainExp(120);
  check('a few kills of EXP');
  for (let i = 0; i < 5; i++) game.character.inventory.add('monster_hide', 3, 'common');
  game.character.addCoins(180);
  check('loot and coins');
  game.devEvent('pedagang');
  game.character.addCoins(500);
  (game as unknown as { buyFromMerchant(i: number): string }).buyFromMerchant(0);
  check('a purchase from the merchant');
  game.dispose();
});
