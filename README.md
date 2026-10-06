# 班級薪資銀行

教師用班級帳務系統。介面以 GitHub Pages 發佈，登入、資料庫、權限和學生照片儲存使用 Supabase。

## 核心規則

- 餘額只看帳戶總額，由不可覆寫的交易流水計算；不做月結或月餘額重置。
- 教師可管理學生、入帳、扣款和商品兌換；學生權限為唯讀。
- 未登入首頁公開顯示啟用公開的班級名稱、學生姓名與目前餘額；座號與頭像可由教師在「基本設定」控制，不公開交易明細。
- 商品兌換建立負數 purchase 交易，交易備註保存兌換物名稱。
- 交易由資料庫保存操作者及時間；Supabase RLS 在資料庫層限制存取。
- 餘額數字是正式帳務值，金幣堆疊圖只負責視覺呈現。

## 開始使用

### 1. 建立 Supabase 專案

1. 在 Supabase 建立專案。
2. 於 SQL Editor 依序執行 [`supabase/migrations/202610060001_initial_schema.sql`](supabase/migrations/202610060001_initial_schema.sql)、[`supabase/migrations/202610060002_public_balances.sql`](supabase/migrations/202610060002_public_balances.sql) 和 [`supabase/migrations/202610060003_classroom_settings_and_public_avatars.sql`](supabase/migrations/202610060003_classroom_settings_and_public_avatars.sql)。它們會建立資料表、權限政策、公開餘額查詢與教師可管理的首頁設定。
3. 在 Authentication > Users 建立教師電子郵件/密碼帳戶，並停用公開註冊。
4. 將 [`supabase/initial-setup.sql`](supabase/initial-setup.sql) 裡的教師電子郵件改成你的登入信箱、班級名稱改成實際名稱，再於 SQL Editor 執行一次。此設定會啟用該班級的公開餘額頁。
5. 若資料庫已有多個班級，公開餘額 migration 不會自動選擇要公開的班級；請在 SQL Editor 只對要公開的班級設定 `public_balances_enabled = true`。
6. 從 Project Settings > API 取得 Project URL 與 publishable key（舊專案可能顯示 anon key）。不要把 `service_role` / secret key 放進瀏覽器或 GitHub Pages。

### 2. 本機啟動

需要 Node.js 20 或更新版本。PowerShell 設定本機環境變數後啟動：

```powershell
$env:SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "YOUR-PUBLISHABLE-KEY"
npm start
```

開啟 http://localhost:4173。應用程式不需要 npm 套件安裝。

未登入時會進入學生餘額首頁；教師按「教師登入」並登入後，可在「基本設定」控制公開首頁是否顯示座號與學生照片。學生照片預設不公開；開啟後仍使用私有 Storage bucket，只允許取得短效簽名網址，不開放照片資料表或永久公開網址。

### 3. GitHub Pages 部署

1. 將此資料夾推送到 GitHub repository 的 `main` 分支。
2. Repository Settings > Secrets and variables > Actions 新增 `SUPABASE_URL` 與 `SUPABASE_PUBLISHABLE_KEY`。
3. Repository Settings > Pages 將 Source 設為 **GitHub Actions**。
4. 推送到 `main` 或手動執行 `Deploy classroom salary bank to GitHub Pages` workflow。

Workflow 會產生未納入 Git 的 `public/config.js` 並部署 `public/`。Supabase publishable key 會出現在網站的公開前端設定中；這是預期行為，資料安全必須依賴 RLS。Supabase secret/service-role key 絕不可放入 GitHub Secrets 給前端使用。

第一次部署後，將 GitHub Pages 網址加入 Supabase Authentication 的 Site URL / Redirect URLs 設定。

## 文件

- [完整規格](SPEC.md)
- [開發進度](TODO.md)
- [功能需求](docs/requirements.md)
- [資料模型](docs/data-model.md)
- [UI/UX 規格](docs/ui.md)
- [業務規則](docs/business-rules.md)

## 目前版本範圍

已建立教師登入、學生帳戶總覽、薪資/扣款交易、商品管理與教師代辦兌換的初版介面和 Supabase 資料層。學生登入畫面、行為規則管理、照片上傳及完整個人帳本仍在開發清單中。尚未連上你的 Supabase 專案或 GitHub repository，需依上方步驟提供專案設定後才能部署。
