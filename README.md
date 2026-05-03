# 喬喬集點屋 (celesterewards)

幫妹妹喬喬集點換獎勵的 PWA。

## 結構

- `index.html` `app.js` `style.css` `sw.js` `manifest.json` — 前端 PWA
- `icons/` — App 圖示
- `worker/` — Cloudflare Worker（KV-based 同步後端）

## 前端部署（GitHub Pages）

1. 把整個 repo push 到 GitHub
2. Settings → Pages → Source: `main` branch / `/` (root)
3. 開啟後網址：`https://saygmu.github.io/celesterewards/`

## 後端部署（Cloudflare Worker）

需要 wrangler CLI（透過 `npx` 不用全域安裝）。

```bash
cd worker

# 1. 登入 Cloudflare
npx wrangler login

# 2. 建立 KV namespace（會回傳一組 id）
npx wrangler kv namespace create STATE_KV

# 3. 把回傳的 id 填到 wrangler.toml 的 REPLACE_WITH_KV_ID

# 4. 部署
npx wrangler deploy
```

部署後會得到網址 `https://celesterewards-sync.<your-subdomain>.workers.dev`。
如果不是 `saygmulovesgreen` 子網域，要改 `app.js` 裡的 `SYNC_BASE` 常數。

## 第一次使用

1. 開網頁 → 設 4 位數密碼（兩次確認）
2. 設 4-8 位數同步 PIN（跨裝置共用）
3. 系統嘗試啟用 Face ID（WebAuthn）— iOS Safari 支援 Touch ID / Face ID
4. 進管理模式建立任務、獎品

## Face ID 注意事項

- WebAuthn 需要 HTTPS（GitHub Pages 已自動）
- 第一次使用需在 Safari 開啟（不是 Chrome）
- 不支援的裝置會自動 fallback 到密碼

## 圖示

`icons/icon-192.png`、`icon-512.png` 目前是純粉紅色佔位圖。要可愛圖示請：
1. 自己畫一張 512x512 PNG（粉色系）
2. 縮成 192x192 另一份
3. 替換掉 `icons/` 兩個檔
