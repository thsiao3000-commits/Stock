# 變更紀錄（Changelog）

本專案版本格式採 [語意化版本](https://semver.org/lang/zh-TW/)（MAJOR.MINOR.PATCH）。
版本號定義於 `index.html` 的 `APP_VERSION` 常數，並對應 git tag。

---

## 🔖 如何升版（維護備查）

**版號規則**（從目前版本往上加）：
- **MAJOR**（x.0.0）：重大改版、資料格式不相容（例如 localStorage 結構變更需遷移）。
- **MINOR**（1.x.0）：新增功能，且向下相容（例如多一種資產類型、新分析模式）。
- **PATCH**（1.0.x）：修 bug、文案/樣式微調，無新功能。

**升版步驟**（三處務必對齊，否則畫面、tag、紀錄會不一致）：

1. 改 `index.html` 的版本常數（唯一來源）：
   ```js
   const APP_VERSION = 'v1.2.3';
   ```
2. 更新本檔（CHANGELOG.md）新增版本區塊，並改 `README.md` 開頭的「版本：」那行。
3. commit、打 tag、推送（含 tag）：
   ```bash
   git add -A && git commit -m "Release v1.2.3"
   git tag -a v1.2.3 -m "v1.2.3 — 一句話描述"
   git push origin main
   git push origin v1.2.3
   ```

> 提醒：tag 要指向「已含新版號的 commit」，所以**先 commit 再 tag**。
> 查現有 tag：`git tag -l`；GitHub Pages 會在 push main 後自動重新部署最新版。

---

## [v1.0.0] — 2026-06-13

首個正式版本。個人投資組合追蹤 + AI 分析工具（單檔純前端）。

### 功能
- **三種資產**：台股（TWSE 收盤）、美股（Twelve Data）、海外公司債（手動 Mark）。
- **加權平均成本法**損益：未實現／已實現／股息息收／總損益，全部換算新台幣加總；各市場小計與占比。
- **逐筆交易**：買進／賣出／現金股息補登；台股手續費與證交稅自動試算。
- **債券**：自動推算配息行事曆、已收息（扣前手息）、應計利息；到期以面額計。
- **走勢圖**：近一年日線 + 我的均價虛線 + 買賣點標記 + 懸停乖離。
- **AI 個股分析**：52 週週線 + 60 日日線 + 技術指標 + 大盤對照 + 我的持倉，串流即時顯示。
- **AI 投資組合總評**：配置／集中度／幣別風險／再平衡建議。
- **報告**：產生時間戳、AI 模型、工具版本；可複製、下載為 `.md`。
- **資料**：全部存於瀏覽器 localStorage，不上傳伺服器。
- **匯率**：open.er-api.com 自動抓取（12 小時快取）或手動指定。

### 部署
- 可本機開啟，或部署至 GitHub Pages（`index.html` 為入口）。
