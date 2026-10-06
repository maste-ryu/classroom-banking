# TODO 開發進度

## 已確認規則
- [x] 學生只有查看權限；商店兌換由教師操作
- [x] 不做月結或餘額重置；只維護帳戶總餘額
- [x] 兌換建立扣款交易，並以備註記錄兌換品項
- [x] 餘額以金額數字及金幣堆疊圖呈現
- [x] 每日記薪不防止重複入帳；每次確認均新增交易
- [x] 交易與更正的操作者及時間保存於資料庫

## 平台設定
- [x] GitHub Pages 靜態網站部署流程
- [x] Supabase Auth、Postgres、RLS 與 Storage 架構
- [x] 指定 GitHub repository：maste-ryu/classroom-banking（遠端目前為空）
- [x] Supabase 專案 URL 與 publishable key 已提供，本機設定檔已建立且不納入 Git
- [ ] 將程式推送到 GitHub 並設定 Pages
- [ ] 將 migration 套用至 Supabase，建立教師及班級
- [ ] 設定 GitHub Actions Secrets（SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY）

## 已建立
- [x] Supabase 資料模型與 RLS 初始 migration
- [x] 教師登入與帳戶總覽初版介面
- [x] 未登入學生餘額首頁與資料庫唯讀公開查詢
- [x] 新增學生、薪資/扣款交易、商品及教師代辦兌換流程
- [x] GitHub Pages Actions workflow 與本機 Node server

## 待開發
- [ ] 學生唯讀登入與個人帳戶頁
- [ ] 學生照片上傳與管理介面（Storage bucket / RLS 已規劃）
- [ ] 記點行為管理及快速每日記薪矩陣
- [ ] 帳本分頁、交易更正流程及歷史查詢
- [ ] 驗證資料庫 migration、RLS 與 GitHub Pages 部署

## 驗收與交付
- [ ] 建立驗收案例
- [ ] 設定 Supabase Auth Redirect URLs 與 GitHub Pages 網址
- [ ] 確認部署、備份與使用說明
