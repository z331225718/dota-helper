'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-ui-'));
  let app;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root });
    await app.firstWindow();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const windows = app.windows();
    const window = windows.find((candidate) => candidate.url().endsWith('/renderer/index.html'));
    const overlay = windows.find((candidate) => candidate.url().endsWith('/overlay/index.html'));
    if (!window || !overlay) throw new Error('Expected both dashboard and overlay windows');
    const errors = [];
    window.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    window.on('pageerror', (error) => errors.push(error.message));

    await window.waitForLoadState('domcontentloaded');
    await window.locator('#demo-button').click();
    await window.getByText('幻影刺客', { exact: true }).waitFor();
    await window.getByText('实时建议', { exact: true }).waitFor();
    await window.locator('#enemy-roster input').nth(2).fill('陈');
    await window.locator('#enemy-roster input').nth(2).dispatchEvent('change');
    await window.locator('#enemy-count').getByText('3 / 5', { exact: true }).waitFor();
    await window.locator('#role-select').selectOption('2');
    await window.getByText(/所选分路样本不足/).waitFor();
    await window.screenshot({ path: path.join(artifacts, 'desktop.png') });
    await overlay.getByText('幻影刺客', { exact: true }).waitFor();
    await overlay.locator('#skill-title').getByText('飘忽不定', { exact: true }).waitFor();
    await overlay.screenshot({ path: path.join(artifacts, 'overlay.png') });

    await window.locator('[data-view="plan"]').click();
    await window.locator('#goal-input').fill('蝴蝶');
    await window.locator('#cost-input').fill('5450');
    await window.locator('#goal-form button[type="submit"]').click();
    await window.locator('#plan-list').getByText('蝴蝶', { exact: true }).waitFor();
    await window.screenshot({ path: path.join(artifacts, 'plan.png') });

    await window.locator('[data-view="setup"]').click();
    await window.locator('#selected-path').waitFor();
    await window.waitForTimeout(250);
    await window.screenshot({ path: path.join(artifacts, 'setup.png') });

    await window.locator('[data-view="match"]').click();
    await window.locator('#compact-button').click();
    await window.waitForTimeout(350);
    await window.screenshot({ path: path.join(artifacts, 'compact.png') });

    const layout = await window.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      visiblePanels: Array.from(document.querySelectorAll('#view-match .panel')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length
    }));

    if (errors.length) throw new Error(`Renderer errors:\n${errors.join('\n')}`);
    if (layout.horizontalOverflow) throw new Error('Compact layout has horizontal overflow');
    if (layout.visiblePanels !== 7) throw new Error(`Expected 7 visible panels, got ${layout.visiblePanels}`);
    process.stdout.write(`${JSON.stringify(layout)}\n`);
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
