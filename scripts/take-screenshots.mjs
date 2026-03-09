import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = 'https://prompt.jiun.dev';
const OUT_DIR = path.resolve('docs/assets/screenshots');
const TIMEOUT = 30000;

async function screenshot(page, name, opts = {}) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), ...opts });
  console.log(`  → ${name}.png`);
}

// Universal text replacer — walks all text nodes
async function replaceAllText(page, replacements) {
  await page.evaluate((reps) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      let changed = false;
      let text = walker.currentNode.textContent;
      for (const [from, to] of reps) {
        if (text.includes(from)) {
          text = text.replaceAll(from, to);
          changed = true;
        }
      }
      if (changed) walker.currentNode.textContent = text;
    }
  }, replacements);
}

// Common replacements for all pages
const COMMON_REPLACEMENTS = [
  ['maytryark@gmail.com', 'jiunbae@gmail.com'],
  ['Good afternoon, maytryark', 'Good afternoon, Jiun'],
  ['Good morning, maytryark', 'Good morning, Jiun'],
  ['Good evening, maytryark', 'Good evening, Jiun'],
  ['maytryark', 'Jiun Bae'],
  // Project renames
  ['wow-3d', 'oh-my-prompt'],
  ['calex', 'sidekick-ai'],
  ['nova-pouch', 'devtools-cli'],
  ['burstpick', 'api-toolkit'],
  ['IaC', 'devtools-cli'],
];

// Korean → English prompt replacements
const PROMPT_REPLACEMENTS = [
  ['현재 변경사항들은 보안문제를 고치기위해 업데이트된 변경사항입니다. 확인하고 괜찮다면 커밋 푸시하세요', 'Refactor the authentication middleware to support JWT refresh tokens with sliding expiration'],
  ['저는 이제 oh-my-prompt 를 대중에게 공개하려고합니다. 보안문제가 없는지 꼼꼼하게 해결해주세요', 'Add real-time WebSocket support for live dashboard updates with reconnection logic'],
  ['good there is high disk usage on mac-mini (localhost) check all and find erros', 'Optimize PostgreSQL queries for the analytics endpoint — reduce p95 latency below 200ms'],
  ['현재 burstpick-app (../burstpick-app) 에서 iPadOS를 위한 더 큰 내용 UX를 기다들고있습니다. 확인하고 기선 필요사항을 정리하세요', 'Implement semantic search across prompt history using pgvector embeddings'],
  ['저는 burstpick이 iOS비전을 별도로 만든다고하는데어떻게 시작하면 좋을까요? burstpick -macos 처럼 모든 기능을 제공할건입니다. 우리는 iOS에서 간단하게 burstpick을 사용하고싶습니다(이는 휴대폰에서 작은 사진을 기가낮음에서 여러 ml모델들로 이번 시전들이 올르지 빠르게 확인하고 선택하는 작업을 대신해주다.) 이는 모두 가기기', 'Set up GitHub Actions CI pipeline with automated testing, linting, and Docker builds'],
  ['pull from remote there is updates from remote', 'Design a type-safe API client generator from OpenAPI specs with automatic retry and error handling'],
  // Insights page Korean
  ['현재 변경사항들은 보안문제를 고치기위해', 'Refactor authentication middleware to support JWT refresh tokens with sliding expiration.'],
  ['저는 이제 oh-my-prompt 를 대중에게', 'Add WebSocket support for live dashboard updates with automatic reconnection.'],
];

async function mockPage(page) {
  // Apply all text replacements
  await replaceAllText(page, [...COMMON_REPLACEMENTS, ...PROMPT_REPLACEMENTS]);

  // Handle partial Korean matches (text nodes that still have Korean after exact replacement)
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const fallbacks = [
      'Build a distributed task queue with Redis Streams and graceful shutdown support',
      'Write comprehensive integration tests for the sync API with mocked database fixtures',
      'Create a Terraform module for multi-region Kubernetes deployment with auto-scaling policies',
      'Migrate the legacy REST endpoints to GraphQL with DataLoader for N+1 query prevention',
    ];
    let fallbackIdx = 0;
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (/[\u3131-\uD79D]/.test(text) && text.length > 15) {
        walker.currentNode.textContent = fallbacks[fallbackIdx % fallbacks.length];
        fallbackIdx++;
      }
    }
  });
}

async function mockDashboardExtra(page) {
  // Fix stats line formatting for dashboard recent sessions
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent;
      if (t.includes('43 prompts')) {
        walker.currentNode.textContent = t.replace('43 prompts', '12 prompts').replace('9.2k tokens', '2.4k tokens').replace('9.2K tokens', '2.4k tokens');
      }
    }
  });
}

async function mockSessionsExtra(page) {
  // Fix session metadata that still has original stats
  await page.evaluate(() => {
    const replacements = [
      ['102h 37m', '25m'],
      ['43 prompts', '12 prompts'],
      ['34 responses', '8 responses'],
      ['9.2k tokens', '2.4k tokens'],
      ['1h 36m', '45m'],
      ['4 prompts', '15 prompts'],
      ['198 tokens', '3.8k tokens'],
      ['23h 17m', '18m'],
      ['1.5k tokens', '1.6k tokens'],
      ['339 total', '186 total'],
      // Dashboard specific
      ['43 prompts', '12 prompts'],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      let text = walker.currentNode.textContent;
      let changed = false;
      for (const [from, to] of replacements) {
        if (text.includes(from)) {
          text = text.replace(from, to);
          changed = true;
        }
      }
      if (changed) walker.currentNode.textContent = text;
    }
  });
}

async function hideInsightsError(page) {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent.includes('Failed to fetch') && el.offsetHeight < 80 && el.offsetHeight > 0) {
        el.style.display = 'none';
      }
    });
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // === DARK MODE ===
  const darkCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await darkCtx.newPage();

  // Login
  console.log('📸 Login page...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await screenshot(page, 'login');

  console.log('\n🔐 Logging in...');
  await page.fill('input[type="email"]', 'maytryark@gmail.com');
  await page.fill('input[type="password"]', 'Jiun5486@#');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Dashboard
  console.log('\n📸 Dashboard...');
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(3500);
  await mockPage(page);
  await mockDashboardExtra(page);
  await screenshot(page, 'dashboard');
  await screenshot(page, 'dashboard-full', { fullPage: true });

  // Sessions
  console.log('\n📸 Sessions...');
  await page.goto(`${BASE_URL}/sessions`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(3500);
  await mockPage(page);
  await mockSessionsExtra(page);
  await screenshot(page, 'sessions');

  // Search
  console.log('\n📸 Search...');
  await page.goto(`${BASE_URL}/search`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(2500);
  await mockPage(page);
  await screenshot(page, 'search');

  // Analytics
  console.log('\n📸 Analytics...');
  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(3500);
  await mockPage(page);
  await screenshot(page, 'analytics');
  await screenshot(page, 'analytics-full', { fullPage: true });

  // AI Insights
  console.log('\n📸 AI Insights...');
  await page.goto(`${BASE_URL}/insights`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(3500);
  await mockPage(page);
  await hideInsightsError(page);
  await screenshot(page, 'insights');

  // Templates
  console.log('\n📸 Templates...');
  await page.goto(`${BASE_URL}/templates`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForTimeout(2500);
  await mockPage(page);
  await screenshot(page, 'templates');

  await darkCtx.close();

  // === LIGHT MODE ===
  console.log('\n📸 Light mode...');
  const lightCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const lp = await lightCtx.newPage();

  await lp.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await lp.fill('input[type="email"]', 'maytryark@gmail.com');
  await lp.fill('input[type="password"]', 'Jiun5486@#');
  await lp.click('button[type="submit"]');
  await lp.waitForTimeout(3000);

  await lp.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await lp.waitForTimeout(3500);
  await mockPage(lp);
  await mockDashboardExtra(lp);
  await screenshot(lp, 'dashboard-light');

  await lp.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await lp.waitForTimeout(3500);
  await mockPage(lp);
  await screenshot(lp, 'analytics-light');

  await lightCtx.close();
  await browser.close();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
