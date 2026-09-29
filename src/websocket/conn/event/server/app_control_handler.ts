import logger from "@common/log4js_config.js";
import { ControlMsg } from "@model/texhub/app/control_msg.js";
import { AppControlType } from "@model/texhub/app/app_control_type.js";
import { getYDoc } from "@collar/yjs_utils.js";
import { WSSharedDoc } from "@collar/ws_share_doc.js";
// @ts-ignore
import { createEncoder, toUint8Array, writeVarUint } from "lib0/encoding.js";
import { Socket } from "socket.io";
import { SyncMessageType } from "@model/texhub/sync_msg_type.js";
import { send } from "../../action/ws_action.js";
// @ts-ignore
import * as syncProtocol from "y-protocols/sync";
// @ts-ignore
import * as decoding from "lib0/decoding";
import { SyncFileAttr } from "@/model/texhub/sync_file_attr.js";
import { TeXFileType } from "@model/enum/tex_file_type.js";
import {
  assertFileBelongsToProject,
  getAccessScope,
} from "./authorization.js";

export const handleControlSignals = (message: Uint8Array, conn: Socket) => {
  try {
    const decoder = decoding.createDecoder(message);
    let msgContent = decoding.readVarString(decoder);
    logger.info(
      "Message content from server::",
      decoding.readVarString(decoder)
    );
    const str = msgContent;
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

const handleSwitchFiles = async (msg: ControlMsg, conn: Socket) => {
  // 客户端传来的 fileId 完全不可信：必须确认它落在本连接已授权的项目内，
  // 否则这行就是「传任意 file_id 拿回该文件的 sync step 1」，
  // 等价于全平台任意文件读取。
  const ownership = await assertFileBelongsToProject(conn, String(msg.fileId || ""));
  if (!ownership.allowed) {
    logger.error(
      `[ws-authz] SwitchEditFile rejected, fileId=${msg.fileId}, reason=${ownership.reason}`
    );
    return;
  }

  const accessScope = getAccessScope(conn);
  let syncFileAttr: SyncFileAttr = {
    docName: String(msg.fileId),
    projectId: accessScope ? accessScope.projectId : "",
    docType: TeXFileType.TEX,
    docShowName: "unknown",
    src: "handleSwitchFiles",
  };
  const doc: WSSharedDoc = await getYDoc(syncFileAttr, true);
  const encoder = createEncoder();
  writeVarUint(encoder, SyncMessageType.MessageControl);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, toUint8Array(encoder), syncFileAttr);
};
