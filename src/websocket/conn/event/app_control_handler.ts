import logger from "@common/log4js_config.js";
import { ControlMsg } from "../../../model/texhub/app/control_msg.js";
import { AppControlType } from "../../../model/texhub/app/app_control_type.js";
import { getYDoc } from "../../../collar/yjs_utils.js";
import { WSSharedDoc } from "../../../collar/ws_share_doc.js";
import { createEncoder, toUint8Array, writeVarUint } from "lib0/encoding.js";
import { Socket } from "socket.io";
import { SyncMessageType } from "../../../model/texhub/sync_msg_type.js";
import { send } from "../ws_action.js";
// @ts-ignore
import syncProtocol from "y-protocols/dist/sync.cjs";
// @ts-ignore
import decoding from "lib0/dist/decoding.cjs";

export const handleControlSignals = (message: Uint8Array, conn: Socket) => {
  try {
    const decoder = decoding.createDecoder(message);
    let msgContent = decoding.readVarString(decoder);
    logger.info(
      'Message content from server::',
      decoding.readVarString(decoder)
    );
    const decoderutf = new TextDecoder("utf-8");
    const str = decoderutf.decode(msgContent);
    console.log("decode:" + str);
  } catch (err) {
    logger.error("parse failed", err);
  }
  const decoderText = new TextDecoder("utf-8");
  const str = decoderText.decode(message);
  const replacedText = str.replace(">", "").replace("=", "");
  logger.info("receive control message:" + str);
  let controlMsg: ControlMsg = JSON.parse(replacedText);
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
