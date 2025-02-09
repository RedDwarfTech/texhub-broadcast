import http, { RequestOptions } from "http";
import { WSSharedDoc } from "./ws_share_doc.js";
import _ from "lodash";

const CALLBACK_URL = process.env.CALLBACK_URL
  ? new URL(process.env.CALLBACK_URL)
  : null;
const CALLBACK_TIMEOUT = process.env.CALLBACK_TIMEOUT || 5000;
const CALLBACK_OBJECTS = process.env.CALLBACK_OBJECTS
  ? JSON.parse(process.env.CALLBACK_OBJECTS)
  : {};

exports.isCallbackSet = !!CALLBACK_URL;

/**
 * @param {URL} url
 * @param {number} timeout
 * @param {Object} data
 */
export const callbackRequest = (url: URL, timeout: number, data: Object) => {
  data = JSON.stringify(data);
  const options: RequestOptions = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    timeout,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": _.size(data),
    },
  };
  const req = http.request(options);
  req.on("timeout", () => {
    console.warn("Callback request timed out.");
    req.abort();
  });
  req.on("error", (e) => {
    console.error("Callback request error.", e);
    req.abort();
  });
  req.write(data);
  req.end();
};

/**
 * @param {string} objName
 * @param {string} objType
 * @param {WSSharedDoc} doc
 */
export const getContent = (
  objName: string,
  objType: string,
  doc: WSSharedDoc
) => {
  switch (objType) {
    case "Array":
      return doc.getArray(objName);
    case "Map":
      return doc.getMap(objName);
    case "Text":
      return doc.getText(objName);
    case "XmlFragment":
      return doc.getXmlFragment(objName);
    case "XmlElement":
      return doc.getXmlElement(objName);
    default:
      return {};
  }
};
