#### introduce

This project was mostly come from y-websocket, it used as texhub collaborate backend. I changed the code to typescript by default.

* the persistance store using PostgreSQL to make it can scale herizonal
* default using typescript
* support Yjs subdocument(working....)
* all import/export using esm, do not use cjs
* using socket.io as the websocket communication component

#### start app

```bash
pnpm vite-node src/app.ts
```


