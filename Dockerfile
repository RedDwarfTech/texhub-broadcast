FROM node:22-bookworm-slim

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package*.json ./
COPY dist ./dist
# apt 换源必须在 apt-get 之前生效（覆盖 Debian 12 的 deb822 源文件）；
# node:22-bookworm-slim 使用 /etc/apt/sources.list.d/debian.sources 而非旧的
# /etc/apt/sources.list。bullseye 已于 2024-08 EOL，安全更新已被 archive，故升 bookworm。
ADD ./docs/sources.list /etc/apt/sources.list.d/debian.sources
USER root
RUN npm install && npm install npx && apt-get update && apt-get install curl -y
# RUN apk update && apk add curl websocat
COPY --chown=node:node . .
COPY ./scripts/startup-app.sh /home/node/app
EXPOSE 1234

CMD ["sh","./startup-app.sh"]