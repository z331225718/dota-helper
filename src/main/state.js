'use strict';

const HERO_FIELDS = [
  'id', 'name', 'level', 'alive', 'respawn_seconds', 'buyback_cost',
  'buyback_cooldown', 'health', 'max_health', 'health_percent', 'mana',
  'max_mana', 'mana_percent', 'silenced', 'stunned', 'disarmed',
  'magicimmune', 'hexed', 'muted', 'break', 'aghanims_scepter',
  'aghanims_shard', 'smoked'
];

const PLAYER_FIELDS = [
  'steamid', 'accountid', 'name', 'activity', 'kills', 'deaths', 'assists',
  'last_hits', 'denies', 'kill_streak', 'team_name', 'gold', 'gold_reliable',
  'gold_unreliable', 'gpm', 'xpm'
];

const MAP_FIELDS = [
  'name', 'matchid', 'game_time', 'clock_time', 'daytime',
  'nightstalker_night', 'radiant_score', 'dire_score', 'game_state', 'paused',
  'win_team', 'customgamename', 'ward_purchase_cooldown'
];

const PROVIDER_FIELDS = ['name', 'appid', 'version', 'timestamp'];
const ABILITY_FIELDS = ['name', 'level', 'can_cast', 'passive', 'ability_active', 'cooldown', 'ultimate'];
const ITEM_FIELDS = ['name', 'purchaser', 'can_cast', 'cooldown', 'charges', 'passive'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(source, fields) {
  if (!isRecord(source)) return {};

  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(source, field))
      .map((field) => [field, source[field]])
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
  );
}

function normalizeCollection(source, fields) {
  if (!isRecord(source)) return [];

  return Object.entries(source)
    .filter(([, value]) => isRecord(value))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([slot, value]) => ({ slot, ...pick(value, fields) }))
    .filter((entry) => typeof entry.name === 'string' && entry.name.length > 0);
}

function normalizeGsiPayload(payload, receivedAt = Date.now()) {
  const safePayload = isRecord(payload) ? payload : {};
  const map = pick(safePayload.map, MAP_FIELDS);
  const player = pick(safePayload.player, PLAYER_FIELDS);
  const hero = pick(safePayload.hero, HERO_FIELDS);

  return {
    receivedAt,
    provider: pick(safePayload.provider, PROVIDER_FIELDS),
    map,
    player,
    hero,
    abilities: normalizeCollection(safePayload.abilities, ABILITY_FIELDS),
    items: normalizeCollection(safePayload.items, ITEM_FIELDS),
    inMatch: Boolean(map.matchid || map.game_state || hero.id || hero.name)
  };
}

module.exports = {
  normalizeGsiPayload
};
