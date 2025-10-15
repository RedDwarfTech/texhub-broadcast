// @ts-ignore
import * as Y from "rdyjs";
// @ts-ignore
import * as decoding from "rdlib0/decoding.js";
import { UpdateOrigin } from "@/model/yjs/net/update_origin";

export function msgProbe() {
  console.log("msgProbe called");
}

export function logYjsUnwrapMsg(decoder: any, docContext: any) {
  try {
    const messageType = decoding.readVarUint(decoder);
    console.log("parse messageType: ", messageType);
    let update = decoding.readVarUint8Array(decoder);
    const hasContent = decoding.hasContent(decoder);
    if (!hasContent) {
      console.error(
        "logYjsUnwrapMsg doc message sync has no content," +
          JSON.stringify(docContext)
      );
      return;
    }
    const structDecoder = new Y.UpdateDecoderV2(update);
    console.log("structDecoder: ", structDecoder);
    let ydoc = new Y.Doc();
    let uo: UpdateOrigin = {
      name: "logYjsUnwrapMsg",
      origin: "client",
    };
    Y.applyUpdate(ydoc, update, uo);
    let docText = ydoc.getText();
    let ydocText = docText.toString();
    console.log("ydoc text: ", ydocText);
  } catch (e: any) {
    console.log(e);
  }
}

export function enableTracing() {
  if (localStorage) {
    let enableTracing = localStorage.getItem("enableTracing");
    if (enableTracing) {
      return enableTracing === "true";
    }
  }
  return false;
}

export function disableTracing() {}
