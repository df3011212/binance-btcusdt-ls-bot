// bot.js — 幣安 BTC 永續合約多空比推播（每日 12:05 + 啟動即推）
import 'dotenv/config'
import puppeteer from 'puppeteer'
import cron from 'node-cron'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import FormData from 'form-data'

const URL         = 'https://sosovalue.com/tc/dashboard/binance-btcusdt-futures-long-short-ratio-1d'
const CANVAS_SEL  = 'canvas[data-zr-dom-id="zr_0"]'
const SHOT_DIR    = path.join('.', 'screenshots')

// === Telegram Token / Chat ID ===
const TG_TOKEN   = process.env.TELEGRAM_TOKEN
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
if (!TG_TOKEN || !TG_CHAT_ID) {
  console.error('⛔️ TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 尚未設定於 .env')
  process.exit(1)
}

// === 多空解讀邏輯 ===
function evaluate(positionRatio) {
  const n = Number(positionRatio)
  if (n >= 1.8) return {
    level: '🧨 極端偏多',
    explain: '大戶重倉做多，短期可能誘多，需警惕反轉風險。',
    advice:  '避免追高，觀察是否回踩支撐。'
  }
  if (n >= 1.4) return {
    level: '📈 偏多格局',
    explain: '大戶資金做多明顯，行情偏強。',
    advice:  '可順勢做多，但設好停利。'
  }
  if (n >= 1.1) return {
    level: '🟢 小幅偏多',
    explain: '多頭略佔優勢，但尚未明顯突破。',
    advice:  '觀察價格是否同步走高。'
  }
  if (n >= 0.9) return {
    level: '🟡 中性盤整',
    explain: '市場多空勢均力敵，方向未明。',
    advice:  '耐心觀望，等待放量突破。'
  }
  if (n >= 0.6) return {
    level: '🔻 偏空格局',
    explain: '空方略佔優勢，價格可能持續承壓。',
    advice:  '短線避免追多，關注回調機會。'
  }
  return {
    level: '⚠️ 強烈偏空',
    explain: '大戶集中做空，市場偏弱，反彈恐有限。',
    advice:  '切勿貿然做多，宜保守應對。'
  }
}

// === 傳送 Telegram 圖片 + 文字 ===
async function sendTelegramPhoto(caption, filePath) {
  const url  = `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`
  const form = new FormData()
  form.append('chat_id', TG_CHAT_ID)
  form.append('caption', caption)
  form.append('parse_mode', 'Markdown')
  form.append('photo', fs.createReadStream(filePath))
  await axios.post(url, form, { headers: form.getHeaders() })
}

// === 核心任務 ===
async function runTask() {
  console.log('\n🚀 [任務啟動] 幣安 BTC 多空比推播', new Date().toLocaleString('zh-TW'))

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox']
  })

  try {
    const page = await browser.newPage()
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 5000))   // 等待資料載入

    // 取得三個指標數值
    const [accountRatio, positionRatio, totalRatio] = await page.$$eval(
      '.text-neutral-fg-1-rest.font-bold',
      els => els.slice(1, 4).map(el => el.innerText.trim())
    )

    // 產生日期 & 解讀
    const today = new Date().toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' })
    const { level, explain, advice } = evaluate(positionRatio)

    // 截圖
    const canvas = await page.$(CANVAS_SEL)
    if (!canvas) throw new Error('找不到圖表 Canvas')
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR)
    const shotPath = path.join(SHOT_DIR, `btc-ls-${today.replace(/\//g,'-')}.png`)
    await canvas.screenshot({ path: shotPath })

    // 組 Caption
    const caption = `
📊 *幣安 BTCUSDT 永續合約多空比分析（${today}）*

🔹 大戶多空比（帳戶數）：\`${accountRatio}\`
🔺 大戶多空比（持倉量）：\`${positionRatio}\`
🟣 總體多空比（帳戶數）：\`${totalRatio}\`

📈 *評估*：${level}
📌 *解讀*：${explain}
🧭 *操作建議*：${advice}
    `.trim()

    // 推送 Telegram
    await sendTelegramPhoto(caption, shotPath)
    console.log('✅ 已推送 Telegram')

  } catch (err) {
    console.error('❌ 發生錯誤：', err.message)
  } finally {
    await browser.close()
  }
}

// === 排程：每天 12:05（Asia/Taipei） ===
cron.schedule('5 12 * * *', runTask, { timezone: 'Asia/Taipei' })

// === 啟動時立即執行一次 ===
runTask()
