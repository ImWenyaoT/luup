import { expect, test } from '@playwright/test'

test('completes a deterministic research run through the Node server', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Luup' })).toBeVisible()
  await page.getByPlaceholder('提出一个可以设计实验去检验的研究问题').fill(
    '冻结证据能降低科研 Agent 的无来源引用吗？',
  )
  await page.getByRole('button', { name: '开始研究' }).click()

  await expect(page.getByText('已完成')).toBeVisible()
  await expect(page.getByText('证据链 · 1 次检索')).toBeVisible()
  await expect(page.getByText('arxiv:2309.15217v2')).toBeVisible()

  const stages = page.getByRole('list').first().getByRole('listitem')
  await expect(stages).toHaveCount(5)
  await expect(page.getByText('冻结产物')).toBeVisible()
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/)

  // Run 已持久化；刷新后要从 URL 恢复，而不是变成无法进入的后台任务。
  // 连续四次失败会跨过第一轮快速重试；页面仍应在稍后的恢复轮自动回来。
  await page.route('**/api/runs/*', (route) => route.fulfill({
    status: 503,
    json: { detail: '临时不可用' },
  }), { times: 4 })
  await page.reload()
  await expect(page.getByText('临时不可用')).toBeVisible()
  await expect(page.getByText('已完成')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('临时不可用')).not.toBeVisible()
  await expect(page.getByText('证据链 · 1 次检索')).toBeVisible()
  await expect(page.getByText(/^version:/)).not.toBeVisible()
  await page.getByText('技术详情').first().click()
  await expect(page.getByText(/^version:/)).toBeVisible()

  // 新建失败不能把当前 Run 从 UI 状态中切断。
  await page.getByPlaceholder('提出一个可以设计实验去检验的研究问题').fill('问'.repeat(4_001))
  await page.getByRole('button', { name: '开始研究' }).click()
  await expect(page.getByText('question 不能超过 4000 个字符。')).toBeVisible()
  await expect(page.getByText('已完成')).toBeVisible()
  await expect(page.getByText('证据链 · 1 次检索')).toBeVisible()

  // 旧 Artifact 先失败、新 Run 后成功时，旧错误不能挂到新 Run 下。
  await page.route('**/api/artifacts/*', async (route) => {
    await new Promise((done) => setTimeout(done, 50))
    await route.fulfill({ status: 500, json: { detail: '旧 Artifact 失败' } })
  }, { times: 1 })
  await page.evaluate(() => {
    const originalFetch = window.fetch
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url
      if (url === '/api/runs' && args[1]?.method === 'POST') {
        await new Promise((done) => setTimeout(done, 100))
      }
      return response
    }
  })
  await page.getByRole('button', { name: 'research-plan' }).click()
  await page.getByPlaceholder('提出一个可以设计实验去检验的研究问题').fill('第二个研究问题')
  await page.getByRole('button', { name: '开始研究' }).click()
  await expect(page.getByText('旧 Artifact 失败')).toBeVisible()
  await expect(page.getByText('旧 Artifact 失败')).not.toBeVisible()
  await expect(page.getByText('已完成')).toBeVisible()

  await page.getByRole('button', { name: 'research-plan' }).click()
  await expect(page.getByText('降低无来源引用率并保持任务完成率。')).toBeVisible()
  await expect(page.getByText('证据门组显著更低。')).toBeVisible()

  let missingRunRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/runs/deadbeef')) missingRunRequests += 1
  })
  await page.goto('/?run=deadbeef')
  await expect(page.getByText('Run 不存在。')).toBeVisible()
  await page.waitForTimeout(5_500)
  expect(missingRunRequests).toBe(1)

  await page.getByPlaceholder('提出一个可以设计实验去检验的研究问题').fill('从无效深链重新开始')
  await page.getByRole('button', { name: '开始研究' }).click()
  await expect(page.getByText('Run 不存在。')).not.toBeVisible()
  await expect(page.getByText('已完成')).toBeVisible()
})
