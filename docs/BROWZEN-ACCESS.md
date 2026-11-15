# Neutron 的 Browzen Access

Neutron 可以在同一個 Render Node Web Service 內架設真正的公鑰 `.bzn` 網站。它沿用 [Browzen Network](https://github.com/NeuralNexusLab-nh/Browzen/blob/main/BrowzenNetwork.md) 的 `BznHost`、HPKE 握手及加密封包協定，使用原有 Express 埠，不另開 Web Service，不依賴保持開啟的 Host 網頁。

## Render ENV

在原有服務新增一個 secret environment variable：

| 名稱 | 值 |
| --- | --- |
| `NEUTRON_BZN_SECRET` | `bzn1.` 加上 32 個隨機 bytes 的無 padding Base64URL，共 48 字元 |

可以在自己的電腦用 Node.js 產生，不需要專用資料夾。以下是 **Windows PowerShell** 指令；`--%` 防止 PowerShell 改動傳給 Node 的引號：

```powershell
node --% -e "console.log('bzn1.'+require('node:crypto').randomBytes(32).toString('base64url'))"
```

如果已下載 Neutron repo，也可以執行：

```sh
npm run generate:bzn
```

第二個指令還會顯示對應的公開地址。把完整 `bzn1.…` 字串貼進 Render 的 ENV **值**，不要貼 `NEUTRON_BZN_SECRET=` 前綴，不加引號。不要把私鑰交給聊天室、GitHub、URL 或前端。它不是 Tor 金鑰，也不是 OPAQUE setup；三者分開保管。可直接匯入 Browzen 地址產生器建立的 `bzn1.…` 私鑰。

保留原有 `NEUTRON_OPAQUE_SERVER_SETUP` 和 onion ENV。Build Command 仍是 `npm ci && npm run build:render`，Start Command 仍是 `node server.js`。不要新增服務、背景 worker 或公開埠。

儲存並重新部署後，開啟 `/api/bzn`：

```json
{
  "enabled": true,
  "state": "hosting",
  "address": "<52 lowercase Base32 characters>.bzn",
  "url": "https://browzen.nxlabtw.com/?bzn=<public-key-address>.bzn"
}
```

範例中的 `<…>` 是說明文字，不是可用地址。`state` 可能為 `disabled`、`invalid_key`、`starting`、`hosting`、`retrying`、`failed` 或 `stopped`。只有公開地址和狀態會回傳，私鑰不會回傳或寫入執行日誌。未設定金鑰時保持停用；無效金鑰不會被替換成新的隨機身分。

首頁在 **Onion Access 右側** 顯示 **Browzen Access**。它會開啟 Browzen Web 並帶入真正的公鑰地址。BZN 尚未設定或尚未取得公開地址時，連結保持隱藏。手機窄螢幕可換行，兩個連結仍依此順序排列。

保存同一個 secret，重啟後就恢復同一個 `.bzn` 地址。遺失私鑰無法恢復地址；更換私鑰會改變地址。請自行保存離線備份。

## 運作方式

1. Express 先啟動，HTTPS／onion 照常運作。
2. 伺服器以 `bzn1.` seed，透過 HPKE 的 X25519 deterministic key derivation 取得網站公私鑰。完整公鑰編碼為 52 字元 Base32 加 `.bzn`。
3. Node `BznHost` 以此地址的 stem 作為公共 Neutron mailbox PIN。Node room adapter 使用與瀏覽器相同的 OPAQUE、PIN 衍生及三層內容加密實作，透過本機 HTTP 連向現有 Express。
4. Browzen 訪客把隨機 session、兩個方向的房間 PIN 和 challenge，以網站公鑰用 HPKE 加密後送入公共 mailbox。
5. Host 用私鑰解開，加入私密方向房間，送出加密確認。完成 challenge 確認後才轉送網站請求。
6. 網站請求和回應經 BZN 的加密、分片、ACK、重送協定在 Neutron 上傳遞。Host 只轉送到 `http://127.0.0.1:$PORT`，不接受外部網站或其他 localhost 埠；禁止 redirects。
7. 首頁、CSS、JS、WASM 和聊天室 API 都從同一個 `.bzn` 來源取得。端點與既有 HTTPS／onion 共用同一個房間 RAM，沒有另外一份訊息資料庫。

這個地址須在 Browzen Web 使用，一般 DNS 或普通瀏覽器不能直接解析。Browzen 原有的短名 `neutron.bzn` 是直接跳到 HTTPS 的捷徑，與這裡真正的公鑰網站不同。

## 驗證與限制

`npm test` 的 BZN 整合測試會啟動真實本機 Express 與 RAM relay，以原版 BznClient 完成加密握手、載入 Neutron HTML／加密模組／WASM，並將聊天登入、prepare、upload、list、claim 全部經 BZN 傳送，最後驗證解密明文。它也檢查外部 URL 被拒絕及私鑰不出現在公開狀態。

Browzen 是自訂的網站內容引擎，瀏覽器功能相容性仍受其限制。BZN 輪詢和分片比 HTTPS 慢，尤其首次載入 WASM；不是大型檔案或影音串流服務。Neutron 訊息仍只保留約 15 秒，慢連線可能漏收聊天室訊息。現行 BznHost 預設最多八個連線 session，每個最多四個同時請求。

Render 休眠、重啟、資源不足或 relay 故障都可能中斷連線。只有單一實例 RAM，不能直接橫向擴展。`hosting` 表示本機 host 已加入 mailbox，不等於所有外部訪客都已成功載入；請以 Browzen 開啟公開地址確認。

加密通道不等於匿名。Neutron／代管平台仍可能觀察來源 IP、時序和流量大小。BZN 的靜態接收者金鑰握手不保證日後私鑰外洩時的前向保密。請閱讀 Browzen Network 的安全界線；此整合未經獨立安全審計。
