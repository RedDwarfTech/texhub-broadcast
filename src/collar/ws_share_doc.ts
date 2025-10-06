// @ts-ignore
import * as Y from "rdyjs";
// @ts-ignore
import {
  createEncoder,
  writeVarUint,
  writeVarUint8Array,
  toUint8Array,
  // @ts-ignore
} from "rdlib0/dist/encoding.mjs";
// @ts-ignore
import * as awarenessProtocol from "rdy-protocols/dist/awareness.mjs";
import debounce from "lodash";
import { send, sendPure } from "../websocket/conn/action/ws_action.js";
import { callbackHandler, updateHandler } from "./yjs_utils.js";
import { ChangeReq } from "../model/yjs/ChangeReq.js";
import { Socket } from "socket.io";
import { enableTracing } from "@/common/tracing/app_trace.js";

const CALLBACK_URL = process.env.CALLBACK_URL
  ? new URL(process.env.CALLBACK_URL)
  : null;
const gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";
export const messageAwareness = 1;
const isCallbackSet = !!CALLBACK_URL;
const CALLBACK_DEBOUNCE_WAIT =
  parseInt(process.env.CALLBACK_DEBOUNCE_WAIT!) || 2000;
const CALLBACK_DEBOUNCE_MAXWAIT =
  parseInt(process.env.CALLBACK_DEBOUNCE_MAXWAIT!) || 10000;
const JWT_SIGN_KEY = process.env.JWT_SIGN_KEY || "key-missing";

export class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<Socket, Set<number>>;
  awareness: any;
  /**
   * @param {string} name
   */
  constructor(name: string) {
    super({ gc: gcEnabled });
    this.name = name;
    /**
     * Maps from conn to set of controlled user ids. Delete all user ids from awareness when this conn is closed
     * @type {Map<Object, Set<number>>}
     */
    this.conns = new Map<Socket, Set<number>>();
    /**
     * @type {awarenessProtocol.Awareness}
     */
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    /**
     * @param {{ added: Array<number>, updated: Array<number>, removed: Array<number> }} changes
     * @param {Object | null} conn Origin is the connection that made the change
     */
    const awarenessChangeHandler = (req: ChangeReq, conn: Socket | null) => {
      const changedClients = req.added.concat(req.updated, req.removed);
      if (conn !== null) {
        const connControlledIDs =
          /** @type {Set<number>} */ this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          req.added.forEach((clientID) => {
            connControlledIDs.add(clientID);
          });
          req.removed.forEach((clientID) => {
            connControlledIDs.delete(clientID);
          });
        }
      }
      // broadcast awareness update
      const encoder = createEncoder();
      writeVarUint(encoder, messageAwareness);
      writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const buff = toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        sendPure(this, c, buff);
      });
    };
    this.awareness.on("update", awarenessChangeHandler);
    // @ts-ignore
    this.on("update", updateHandler);
    if (isCallbackSet) {
      // @ts-ignore
      this.on(
        "update",
        callbackHandler
      );
    }
  }
}
