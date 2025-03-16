import logger from "@common/log4js_config";
import { ControlMsg } from "../../../model/texhub/app/control_msg";
import { AppControlType } from "../../../model/texhub/app/app_control_type";
import { getYDoc } from "../../../collar/yjs_utils";
import { WSSharedDoc } from "../../../collar/ws_share_doc";
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
} from "lib0/encoding.js";
import { Socket } from "socket.io";
import { SyncMessageType } from "../../../model/texhub/sync_msg_type";
import { send } from "../ws_action";
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
