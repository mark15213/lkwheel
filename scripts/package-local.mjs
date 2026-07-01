import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const releaseRoot = path.join(root, "release");
const packageDir = path.join(releaseRoot, "desk-auction-local");

fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

copyDirectory(path.join(root, "dist"), path.join(packageDir, "dist"));
copyDirectory(path.join(releaseRoot, "server"), path.join(packageDir, "server"));

fs.writeFileSync(
  path.join(packageDir, "start-windows.cmd"),
  [
    "@echo off",
    "setlocal",
    "cd /d %~dp0",
    "if \"%PORT%\"==\"\" set PORT=5173",
    "set HOST=0.0.0.0",
    "if exist node\\node.exe (",
    "  node\\node.exe server\\server.mjs",
    ") else (",
    "  node server\\server.mjs",
    ")",
    "pause",
    ""
  ].join("\r\n")
);

fs.writeFileSync(
  path.join(packageDir, "start-mac-linux.sh"),
  [
    "#!/usr/bin/env sh",
    "cd \"$(dirname \"$0\")\"",
    ": \"${PORT:=5173}\"",
    "export PORT",
    "export HOST=0.0.0.0",
    "node server/server.mjs",
    ""
  ].join("\n")
);
fs.chmodSync(path.join(packageDir, "start-mac-linux.sh"), 0o755);

fs.writeFileSync(
  path.join(packageDir, "README-Windows.txt"),
  [
    "工位暗拍局 - Windows 免 npm 运行包",
    "",
    "运行方式：",
    "1. 如果电脑已安装 Node.js，双击 start-windows.cmd。",
    "2. 如果电脑没有 Node.js：",
    "   - 下载 Node.js 的 Windows Binary zip 包。",
    "   - 在本目录新建 node 文件夹。",
    "   - 把 zip 里的 node.exe 复制到 node\\node.exe。",
    "   - 再双击 start-windows.cmd。",
    "",
    "启动后：",
    "- 主持人打开 http://localhost:5173",
    "- 终端会打印 LAN address: http://你的局域网IP:5173",
    "- 把 LAN address 发给同一 Wi-Fi 下的参与者。",
    "",
    "注意：",
    "- 活动期间不要关闭这个窗口。",
    "- 如果 Windows 防火墙提示是否允许 Node.js 访问网络，请选择允许。",
    "- 如果 5173 被占用，可以在命令行里执行：set PORT=5174，然后再运行 start-windows.cmd。",
    ""
  ].join("\r\n")
);

console.log(`Local package ready: ${packageDir}`);
createZipIfAvailable();

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function createZipIfAvailable() {
  const zipPath = path.join(releaseRoot, "desk-auction-local.zip");
  fs.rmSync(zipPath, { force: true });
  const result = spawnSync("zip", ["-qr", "desk-auction-local.zip", "desk-auction-local"], {
    cwd: releaseRoot,
    stdio: "inherit"
  });

  if (result.status === 0) {
    console.log(`Zip ready: ${zipPath}`);
    return;
  }

  console.log("Zip was not created. You can compress release/desk-auction-local manually.");
}
