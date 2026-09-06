'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'data', 'meta-builds.json');
const D2PT_ROOT = 'https://dota2protracker.com';
const OPENDOTA_ROOT = 'https://api.opendota.com/api';
const MIN_ROLE_MATCHES = 100;
const REQUEST_DELAY_MS = 1_050;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function round(value, digits = 4) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}

function roleCandidates(hero) {
  const roles = [1, 2, 3, 4, 5]
    .map((role) => ({ role, matches: Number(hero[`pos ${role} matches`]) || 0 }))
    .sort((left, right) => right.matches - left.matches);
  const established = roles.filter((entry) => entry.matches >= MIN_ROLE_MATCHES).slice(0, 2);
  return established.length ? established : roles.slice(0, 1);
}

function normalizeItem(item) {
  return {
    id: Number(item.raw_item_id),
    pickRate: round(item.rel_pr ?? item.pr),
    winRate: round(item.win_rate),
    matches: Number(item.rel_count ?? item.count) || 0,
    averageMinute: round(item.avg_minute, 1)
  };
}

function normalizeBuild(payload) {
  const entries = Object.values(payload ?? {})
    .filter((entry) => entry?.build_data)
    .sort((left, right) => Number(right.num_matches) - Number(left.num_matches));
  const entry = entries[0];
  if (!entry) return null;

  const data = entry.build_data;
  const core = (data.anchor_items2 ?? data.anchor_items ?? [])
    .filter((item) => Number.isFinite(Number(item.raw_item_id)))
    .map(normalizeItem);
  const coreIds = new Set(core.map((item) => item.id));
  const situational = (data.items_mid_late ?? [])
    .filter((item) => Number(item.rel_pr ?? item.pr) >= 0.12)
    .filter((item) => Number(item.rel_count ?? item.count) >= 30)
    .filter((item) => !coreIds.has(Number(item.raw_item_id)))
    .map(normalizeItem)
    .slice(0, 14);
  const commonAbilityOrder = data.abilities_new?.[0]?.[0]
    ?? data.abilities?.map((ability) => ability.ability_id)
    ?? [];

  return {
    matches: Number(entry.num_matches) || Number(data.num_matches) || 0,
    winRate: round(Number(entry.num_wins) / Number(entry.num_matches) || data.win_rate),
    updatedAt: entry.updated_at ?? null,
    items: core,
    situational,
    abilityOrder: commonAbilityOrder.map(Number).filter(Number.isFinite),
    abilityOrderMatches: Number(data.abilities_new?.[0]?.[1]?.count) || 0,
    abilityOrderPickRate: round(data.abilities_new?.[0]?.[1]?.pr)
  };
}

async function fetchJsonInPage(page, pathname, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url, { cache: 'no-store' });
        const text = await response.text();
        return { ok: response.ok, status: response.status, text };
      }, pathname);
      if (!result.ok || result.text.startsWith('<')) throw new Error(`D2PT HTTP ${result.status}`);
      return JSON.parse(result.text);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 2_000);
    }
  }
  throw lastError;
}

async function fetchOpenDotaMatchups(heroId, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${OPENDOTA_ROOT}/heroes/${heroId}/matchups`, {
        headers: { 'User-Agent': 'personal-dota-helper-data-builder/1.0' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`OpenDota HTTP ${response.status}`);
      return (await response.json())
        .filter((row) => Number(row.games_played) >= 20)
        .map((row) => ({
          heroId: Number(row.hero_id),
          matches: Number(row.games_played),
          wins: Number(row.wins)
        }));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_500);
    }
  }
  throw lastError;
}

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto(D2PT_ROOT, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(12_000);
    const title = await page.title();
    const patch = title.match(/for\s+(\d+\.\d+[a-z]?)/i)?.[1] ?? '未知';
    const heroList = await fetchJsonInPage(page, '/api/heroes/list');
    const heroes = {};
    const requests = heroList.flatMap((hero) => roleCandidates(hero).map((role) => ({ hero, ...role })));

    for (let index = 0; index < requests.length; index += 1) {
      const { hero, role, matches } = requests[index];
      process.stdout.write(`\rD2PT 构筑 ${index + 1}/${requests.length}：${hero.displayName} ${role} 号位`);
      try {
        const payload = await fetchJsonInPage(page, `/api/hero/${hero.hero_id}/builds?position=pos%20${role}`);
        const build = normalizeBuild(payload);
        if (build) {
          heroes[hero.hero_id] ??= { roles: {} };
          heroes[hero.hero_id].roles[role] = { ...build, roleMatches: matches };
        }
      } catch (error) {
        process.stderr.write(`\n跳过 ${hero.displayName} ${role} 号位：${error.message}\n`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    const matchups = {};
    for (let index = 0; index < heroList.length; index += 1) {
      const hero = heroList[index];
      process.stdout.write(`\rOpenDota 对位 ${index + 1}/${heroList.length}：${hero.displayName}                `);
      try {
        matchups[hero.hero_id] = await fetchOpenDotaMatchups(hero.hero_id);
      } catch (error) {
        process.stderr.write(`\n跳过 ${hero.displayName} 对位：${error.message}\n`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    const output = {
      generatedAt: new Date().toISOString(),
      patch,
      scope: 'D2PT 7000+ MMR recent public matches; OpenDota hero matchups',
      sources: [D2PT_ROOT, 'https://www.opendota.com/'],
      heroes,
      matchups
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`, 'utf8');
    process.stdout.write(`\n已写入 ${OUTPUT_PATH}，${Object.keys(heroes).length} 名英雄，版本 ${patch}。\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
