import logger from "@common/log4js_config.js";
import { ControlMsg } from "../../../model/texhub/app/control_msg.js";
import { AppControlType } from "../../../model/texhub/app/app_control_type.js";
import { getYDoc } from "../../../collar/yjs_utils.js";
import { WSSharedDoc } from "../../../collar/ws_share_doc.js";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
} from "lib0/encoding.js";
import { Socket } from "socket.io";
import { SyncMessageType } from "../../../model/texhub/sync_msg_type.js";
import { send } from "../ws_action.js";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";

export const handleControlSignals = (msg: string, conn: Socket) => {
  let controlMsg: ControlMsg = JSON.parse(msg);
  switch (controlMsg.controlType) {
    case AppControlType.SwitchEditFile: {
      logger.warn("start the switch logic");
      handleSwitchFiles(controlMsg, conn);
      break;
    }
    default: {
      logger.error("no control type handler");
      break;
    }
  }
};

const handleSwitchFiles = (msg: ControlMsg, conn: Socket) => {
  const doc: WSSharedDoc = getYDoc(msg.fileId, true);
  const encoder = createEncoder();
  writeVarUint(encoder, SyncMessageType.MessageControl);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, toUint8Array(encoder));
};
