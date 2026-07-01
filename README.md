# 工位暗拍局

在线实时工位暗拍小游戏。

## 本地部署（推荐）

```bash
npm install
npm run deploy:local
```

主持人电脑打开 `http://localhost:5173`。终端会打印类似 `LAN address: http://192.168.x.x:5173` 的地址，把这个地址发给同一 Wi-Fi 下的参与者即可。

如果 5173 端口被占用，可以换端口：

```bash
PORT=5174 npm run deploy:local
```

本地部署会使用长驻 Node/Socket.IO 服务，房间状态保存在主持人电脑进程内。活动期间不要关闭终端；如果电脑防火墙提示是否允许 Node 接入网络，请选择允许。

## 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，用于开发调试。

## Vercel

这个项目可以部署到 Vercel：

1. 在 Vercel 导入仓库。
2. Framework Preset 选择 `Vite`。
3. 确认 Build Command 是 `npm run build`，Output Directory 是 `dist`。
4. 项目配置已在 `vercel.json` 开启 `"fluid": true`，用于支持 WebSocket。
5. 部署后打开 Vercel 域名。

默认情况下，生产环境会依次尝试 `/api/socket-io`、`/api/socket-io/socket.io`、`/socket.io`。如果 Vercel WebSocket upgrade 失败，前端会自动切到 `/api/realtime` HTTP 轮询兼容模式，仍可创建房间、加入、下注和揭晓。`/api/socket-health` 可用于确认 Vercel API 函数是否已经正常部署。

注意：当前房间状态保存在 Function 内存中，适合小型现场活动和单房间测试。Vercel 多实例或 Function 重启时，房间状态可能丢失；如果要稳定支持多人线上活动，建议再接 Redis/数据库保存房间状态并同步 Socket.IO 事件。

## 更稳的线上部署

如果活动必须稳定，建议：

1. Vercel 部署前端。
2. Railway、Render、Fly.io 等平台部署 `npm run start` 的 Node/Socket.IO 服务。
3. Vercel 环境变量设置：
   - `VITE_SOCKET_URL=https://你的后端域名`
   - `VITE_SOCKET_PATH=/socket.io`

这样房间状态会由长驻 Node 服务持有，不容易因为 Vercel Function 重启或多实例而丢失。
