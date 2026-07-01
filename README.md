# 工位暗拍局

在线实时工位暗拍小游戏。

## Local

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。

## Vercel

这个项目可以部署到 Vercel：

1. 在 Vercel 导入仓库。
2. Framework Preset 选择 `Vite`。
3. 确认 Build Command 是 `npm run build`，Output Directory 是 `dist`。
4. 项目配置已在 `vercel.json` 开启 `"fluid": true`，用于支持 WebSocket。
5. 部署后打开 Vercel 域名。

默认情况下，生产环境会自动连接 `/api/socket-io/socket.io`，不需要额外环境变量。

注意：当前房间状态保存在 Function 内存中，适合小型现场活动和单房间测试。Vercel 多实例或 Function 重启时，房间状态可能丢失；如果要稳定支持多人线上活动，建议再接 Redis/数据库保存房间状态并同步 Socket.IO 事件。

## 更稳的线上部署

如果活动必须稳定，建议：

1. Vercel 部署前端。
2. Railway、Render、Fly.io 等平台部署 `npm run start` 的 Node/Socket.IO 服务。
3. Vercel 环境变量设置：
   - `VITE_SOCKET_URL=https://你的后端域名`
   - `VITE_SOCKET_PATH=/socket.io`

这样房间状态会由长驻 Node 服务持有，不容易因为 Vercel Function 重启或多实例而丢失。
