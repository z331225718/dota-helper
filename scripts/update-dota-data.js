'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API_ROOT = 'https://www.dota2.com/datafeed';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'data', 'dota.zh-CN.json');

async function requestJson(pathname, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}/${pathname}`, {
        headers: { 'User-Agent': 'personal-dota-helper-data-builder/1.0' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.result?.data || (payload.result.status !== undefined && payload.result.status !== 1)) {
        throw new Error('Dota datafeed returned an unsuccessful status');
      }
      return payload.result.data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function pickAbility(ability) {
  return {
    id: ability.id,
    name: ability.name,
    nameZh: ability.name_loc,
    maxLevel: ability.max_level,
    ultimate: ability.type === 1,
    innate: Boolean(ability.ability_is_innate),
    grantedByScepter: Boolean(ability.ability_is_granted_by_scepter),
    grantedByShard: Boolean(ability.ability_is_granted_by_shard)
  };
}

async function run() {
  const [heroListData, itemListData] = await Promise.all([
    requestJson('herolist?language=schinese'),
    requestJson('itemlist?language=schinese')
  ]);

  const heroes = await mapConcurrent(heroListData.heroes, 8, async (hero, index) => {
    process.stdout.write(`\r读取英雄数据 ${index + 1}/${heroListData.heroes.length}`);
    const data = await requestJson(`herodata?language=schinese&hero_id=${hero.id}`);
    const detail = data.heroes?.[0] ?? hero;
    return {
      id: hero.id,
      name: hero.name,
      nameZh: detail.name_loc || hero.name_loc,
      abilities: (detail.abilities ?? []).map(pickAbility)
    };
  });

  const items = (itemListData.itemabilities ?? [])
    .filter((item) => item.name && item.name_loc)
    .map((item) => ({ id: item.id, name: item.name, nameZh: item.name_loc }));

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'Valve Dota 2 datafeed (Simplified Chinese)',
    heroes,
    items
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`\n已写入 ${OUTPUT_PATH}，${heroes.length} 名英雄，${items.length} 件物品。\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
