# 資料庫設計

本文件對應 `supabase/migrations/202610060001_initial_schema.sql` 的第一版 Supabase schema。

## 候選實體

- **classrooms**：班級。
- **profiles / classroom_members**：Supabase Auth 使用者的姓名、角色與班級成員/教師關係。
- **students**：學生帳戶與選用的 Auth 使用者連結、照片 Storage 路徑。
- **behaviors**：教師設定的加薪/扣薪行為模板。
- **store_products**：班級商店商品類型（實體/體驗）、價格與可選庫存。
- **transactions**：不可由一般用戶更新/刪除的帳戶流水，記錄金額、類型、備註、操作者與建立時間。
- **account_balances**：安全檢視表，依完整交易流水計算每位學生餘額；不是可編輯的獨立餘額欄位。

## 關係草案

- 一個班級可包含多位學生、教師及商品。
- 一位學生可有多筆交易；餘額使用 `account_balances` 對完整流水聚合，流水畫面只載入最近交易頁段。
- 每筆交易與更正須保存操作者及建立時間（資料庫持久保存）。
- 每筆兌換由資料庫 `redeem_product` RPC 原子建立負數 purchase 交易、記錄品項備註並更新有限庫存。
- 帳戶總餘額由有效交易累計，不因月份切換而重置；不建立月結資料。

## 權限與稽核

- 所有公開 API 資料表均啟用 RLS；教師只能操作其班級。
- 學生透過 Auth 身分連結至自己的學生資料後，只讀自己的帳戶/交易和所屬班級商品。
- 交易由資料庫寫入 `created_by` 與 `created_at`；Authenticated 用戶沒有更新或刪除交易的資料庫權限。
- 學生照片使用私有 `student-photos` bucket，路徑包含班級與學生 UUID。

## 後續設計

- 金額與點數是否分開，以及使用的精度或單位。
- 交易不得因規則修改而改寫歷史；更正以 adjustment 交易留痕，並保存原因、操作者及時間。
- 唯一鍵、索引、資料保留及備份政策。
