import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import { writeUint32BigEndian } from "lib0/encoding.js";
import { readUint32BigEndian } from "lib0/decoding.js";

const YEncodingString = 0;
const YEncodingUint32 = 1;

export const valueEncoding = {
  buffer: true,
  type: "y-value",
  encode: /** @param {any} data */ (data: any) => data,
  decode: /** @param {any} data */ (data: any) => data,
};

export const keyEncoding = {
  buffer: true,
  type: "y-keys",
  /* istanbul ignore next */
  encode: /** @param {Array<string|number>} arr */ (
    arr: Array<string | number>
  ) => {
    const encoder = encoding.createEncoder();
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v === "string") {
        encoding.writeUint8(encoder, YEncodingString);
        encoding.writeVarString(encoder, v);
      } /* istanbul ignore else */ else if (typeof v === "number") {
        encoding.writeUint8(encoder, YEncodingUint32);
        writeUint32BigEndian(encoder, v);
      } else {
        throw new Error("Unexpected key value");
      }
    }
    return Buffer.from(encoding.toUint8Array(encoder));
  },
  decode: /** @param {Uint8Array} buf */ (buf: Uint8Array) => {
    const decoder = decoding.createDecoder(buf);
    const key = [];
    while (decoding.hasContent(decoder)) {
      switch (decoding.readUint8(decoder)) {
        case YEncodingString:
          key.push(decoding.readVarString(decoder));
          break;
        case YEncodingUint32:
          key.push(readUint32BigEndian(decoder));
          break;
      }
    }
    return key;
  },
};