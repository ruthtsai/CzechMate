# CzechMate 捷適旅

2027 年捷克布拉格交換期間使用的個人 PWA：資源資料庫與旅遊記帳。

- App：https://ruthtsai.github.io/CzechMate/ （用 iPhone Safari 開啟後「加入主畫面」）
- UI 樣稿（範例資料）：https://ruthtsai.github.io/CzechMate/mockup/

個人資料只存在手機本機，不會放進這個 repo。

## 開發

```bash
npm install
npm run dev        # 開發伺服器 http://localhost:5173/CzechMate/
npm test           # 單元測試
npm run build      # 型別檢查與正式建置到 dist/
npm run icons      # 重新產生 App 圖示（需要 Python 與 Pillow）
npm run mockup     # 由 mockup-src/ 重建 public/mockup/
```

推送到 `main` 後，GitHub Actions 會執行測試、建置並發佈到 GitHub Pages。
