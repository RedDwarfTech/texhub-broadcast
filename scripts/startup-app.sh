#!/bin/sh

export HOST=0.0.0.0
export PORT=1234
export YPERSISTENCE=/opt/data/yjs-storage-socketio
# export NODE_OPTIONS="--max-old-space-size=256"

# https://stackoverflow.com/questions/77357320/is-it-possible-to-change-the-node-heap-size
nohup NODE_DEBUG=net node --max-old-space-size=256 --max-semi-space-size=128 --inspect=0.0.0.0:9090 ./dist/app.js >> ws.log 2>&1 &

tail -f ws.log