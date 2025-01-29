FROM node:18-bullseye-slim

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
COPY package*.json ./
COPY dist ./dist
USER root
RUN npm install && npm install npx
# RUN apk update && apk add curl websocat
COPY --chown=node:node . .
COPY ./scripts/startup-app.sh /home/node/app
ADD ./docs/sources.list /etc/apt/ 
EXPOSE 1234
EXPOSE 3000
CMD ["sh","./startup-app.sh"]