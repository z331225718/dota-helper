'use strict';

const SIDES = new Set(['allies', 'enemies']);
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';

function emptySlots() {
  return Array(5).fill(null);
}

function compactHeroIds(entries) {
  return (entries ?? []).map((entry) => Number(entry.heroId)).filter((id) => Number.isFinite(id) && id > 0);
}

class RosterState {
  constructor(validHeroIds) {
    this.validHeroIds = new Set(validHeroIds);
    this.manual = { allies: emptySlots(), enemies: emptySlots() };
    this.matchId = null;
    this.wasPostGame = false;
  }

  reset() {
    this.manual = { allies: emptySlots(), enemies: emptySlots() };
  }

  syncMatch(snapshot) {
    const matchId = snapshot?.map?.matchid ? String(snapshot.map.matchid) : null;
    if (matchId && this.matchId && matchId !== this.matchId) this.reset();
    if (matchId) this.matchId = matchId;

    const postGame = snapshot?.map?.game_state === POST_GAME;
    if (postGame && !this.wasPostGame) this.reset();
    this.wasPostGame = postGame;
  }

  setSlot(side, index, heroId) {
    if (!SIDES.has(side)) throw new Error('阵容分组无效');
    if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error('阵容位置无效');
    const normalizedId = heroId === null || heroId === '' ? null : Number(heroId);
    if (normalizedId !== null && !this.validHeroIds.has(normalizedId)) throw new Error('英雄无效');

    if (normalizedId !== null) {
      for (const currentSide of SIDES) {
        this.manual[currentSide] = this.manual[currentSide].map((value, slot) => (
          value === normalizedId && (currentSide !== side || slot !== index) ? null : value
        ));
      }
    }
    this.manual[side][index] = normalizedId;
  }

  fillSlots(autoIds, manualIds) {
    const used = new Set();
    const slots = emptySlots();
    autoIds.slice(0, 5).forEach((heroId, index) => {
      if (this.validHeroIds.has(heroId) && !used.has(heroId)) {
        slots[index] = { heroId, source: 'gsi', confirmed: true };
        used.add(heroId);
      }
    });
    manualIds.forEach((heroId, index) => {
      if (!slots[index] && this.validHeroIds.has(heroId) && !used.has(heroId)) {
        slots[index] = { heroId, source: 'manual', confirmed: true };
        used.add(heroId);
      }
    });
    for (const heroId of manualIds) {
      if (!this.validHeroIds.has(heroId) || used.has(heroId)) continue;
      const free = slots.indexOf(null);
      if (free === -1) break;
      slots[free] = { heroId, source: 'manual', confirmed: true };
      used.add(heroId);
    }
    return slots;
  }

  get(snapshot) {
    this.syncMatch(snapshot);
    const team = snapshot?.player?.team_name;
    const automatic = snapshot?.roster ?? { draft: {}, spectator: {} };
    const radiant = compactHeroIds(automatic.spectator?.radiant).length
      ? compactHeroIds(automatic.spectator.radiant)
      : compactHeroIds(automatic.draft?.radiant);
    const dire = compactHeroIds(automatic.spectator?.dire).length
      ? compactHeroIds(automatic.spectator.dire)
      : compactHeroIds(automatic.draft?.dire);

    let autoAllies = [];
    let autoEnemies = [];
    if (team === 'RADIANT') [autoAllies, autoEnemies] = [radiant, dire];
    if (team === 'DIRE') [autoAllies, autoEnemies] = [dire, radiant];

    const selfHeroId = Number(snapshot?.hero?.id);
    if (this.validHeroIds.has(selfHeroId)) {
      autoAllies = [selfHeroId, ...autoAllies.filter((id) => id !== selfHeroId)];
    }

    const allies = this.fillSlots(autoAllies, this.manual.allies);
    const allyIds = new Set(allies.filter(Boolean).map((entry) => entry.heroId));
    const enemies = this.fillSlots(autoEnemies.filter((id) => !allyIds.has(id)), this.manual.enemies);
    const automaticCount = [...allies, ...enemies].filter((entry) => entry?.source === 'gsi').length;

    return {
      allies,
      enemies,
      team: team === 'RADIANT' || team === 'DIRE' ? team : null,
      automaticCount,
      allyCount: allies.filter(Boolean).length,
      enemyCount: enemies.filter(Boolean).length,
      complete: allies.every(Boolean) && enemies.every(Boolean),
      note: automaticCount > 1
        ? '已从 Dota 读取可用阵容，仍可手动补全。'
        : '普通玩家视角通常只提供自己的英雄，请手动补全其余阵容。'
    };
  }
}

module.exports = { RosterState };
