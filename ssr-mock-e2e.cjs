// 主题澄清组件「选择记录」mock 端侧验证：pnpm dev 后跑 ?mock=1 页面，读取页面上的记录工具调用日志做断言。
const { chromium } = require('/Users/kehua/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Users/kehua/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('http://localhost:5174/?mock=1');
  await page.waitForSelector('[data-testid="record-count"]');
  const bar = (name) => page.getByRole('button', { name, exact: true });
  const card = (re) => page.getByRole('button', { name: re }).first();
  const retryBtn = () => page.getByRole('button', { name: /^(重试|Retry)$/ });
  const count = async () => Number(await page.getByTestId('record-count').textContent());
  const log = async () => JSON.parse(await page.getByTestId('record-log').textContent());
  const body = async (i = 0) => (await log())[i]?.args?.requestBody;
  const settle = () => page.waitForTimeout(450);
  const r = {};

  // S1 选中推荐项
  await card(/KBC收款数据/).click(); await settle();
  r.S1 = { count: await count(), tool: (await log())[0]?.name, requestBody: await body() };
  // S2 成功后其他卡片禁用，不重复记录
  r.S2 = { otherCardDisabled: await card(/合同回款进度分析/).isDisabled(), count: await count() };
  await page.screenshot({ path: '/Users/kehua/Desktop/workspace/qoder-workspace/ssr-mock-s1.png', fullPage: true });

  // S3 都不是
  await bar('重置选择').click();
  await card(/都不是/).click(); await settle();
  const b3 = await body();
  r.S3 = { count: await count(), action: b3?.action, hasSubjectId: b3 ? 'subjectId' in b3 : null, query: b3?.query, candidateCount: b3?.candidates?.length };

  // S4 回传失败不记录；重试成功只记 1 次
  await bar('重置选择').click();
  await bar('回传失败').click();
  await card(/苍穹 PDT 经营分析/).click(); await settle();
  const afterFail = await count();
  const retryVisible = await retryBtn().isVisible();
  await bar('回传失败').click();
  await retryBtn().click(); await settle();
  const b4 = await body();
  r.S4 = { afterSendFail: afterFail, retryVisible, afterRetry: await count(), subjectId: b4?.subjectId };

  // S5 白名单无记录工具：不调用
  await bar('重置选择').click();
  await bar('白名单含记录工具').click();
  await card(/KBC收款数据/).click(); await settle();
  r.S5 = { count: await count(), selectedLocked: await card(/合同回款进度分析/).isDisabled() };
  await bar('白名单含记录工具').click();

  // S6 记录接口失败：只调 1 次，界面保持成功态
  await bar('重置选择').click();
  await bar('记录接口失败').click();
  await card(/KBC收款数据/).click(); await settle();
  r.S6 = { count: await count(), failed: (await log())[0]?.failed, retryVisible: await retryBtn().isVisible(),
    otherCardDisabled: await card(/合同回款进度分析/).isDisabled() };
  await bar('记录接口失败').click();

  // S7 模拟刷新恢复：已选态，不记录
  await bar('重置选择').click();
  await bar('模拟刷新恢复').click(); await settle();
  r.S7 = { count: await count(), otherCardDisabled: await card(/合同回款进度分析/).isDisabled() };

  r.consoleErrors = consoleErrors;
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
