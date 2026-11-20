# syntax=docker/dockerfile:1
#
# Deva 纯 Web 版镜像：两阶段构建。
#   1) builder：基于本仓库源码装依赖、构建桌面 renderer，再把 preload 打成浏览器
#      shim、把主进程业务模块打成 Node 后端包；
#   2) runtime：只保留 renderer / dist / 原生 node-pty，外加 Chromium（内置浏览器用）。
#
# 构建必须在仓库根执行（context 是仓库根，Dockerfile 在 apps/web）：
#   docker build -f apps/web/Dockerfile -t deva-web .
# 或直接：
#   cd apps/web && docker compose up -d --build

FROM node:20-bookworm-slim AS builder

# 构建阶段只产出 renderer / preload / 主进程 bundle，不需要 Electron 运行时二进制
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

WORKDIR /src
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @deva/web build

# pnpm 的 node_modules 全是指向 .pnpm 的软链，运行阶段不能只搬 @lydell 目录，
# 这里先解引用成真实文件，镜像里只带 node-pty 本体。
RUN mkdir -p /runtime/node_modules/@lydell \
 && cp -rL /src/node_modules/@lydell/. /runtime/node_modules/@lydell/


FROM node:20-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      git \
      bash \
      less \
      procps \
      tzdata \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# 中文文件名 / 终端输出 / git diff 都按 UTF-8 处理；缺省 LANG 时 Debian 会退回 ASCII。
# core.quotepath=false 让 git 不再把中文路径转成 \346\226\207 八进制转义。
RUN git config --system core.quotepath false

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    PORT=7080 \
    HOST=0.0.0.0 \
    DEVA_WEB_DATA=/data \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app

# renderer 与 dist 里的绝对路径必须与构建阶段一致（manifest.json 记录的是 /src/apps/desktop/out/renderer）
COPY --from=builder /src/apps/desktop/out/renderer /src/apps/desktop/out/renderer
COPY --from=builder /runtime/node_modules/@lydell /src/node_modules/@lydell
COPY --from=builder /src/apps/web/dist /app/dist
COPY --from=builder /src/apps/web/server.mjs /app/server.mjs
COPY --from=builder /src/apps/web/package.json /app/package.json
COPY --from=builder /src/apps/web/src /app/src
COPY --from=builder /src/apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data /src

# 不写 USER：entrypoint 以 root 修正 /data 属主后降权到 node 再 exec。
# 只给启动瞬间 root，应用进程仍然是 uid 1000。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

VOLUME ["/data"]
EXPOSE 7080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
