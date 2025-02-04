import { io, Socket } from "socket.io-client";

const SocketPolyfill1 = {
  // 构造函数
  new(url: string | URL, protocols?: string | string[]): Socket {
    // 将 URL 转换为字符串（如果传入的是 URL 对象）
    const urlString = typeof url === "string" ? url : url.toString();
    // 使用 socket.io-client 创建连接
    return io(urlString, {
      transports: ["websocket"], // 强制使用 WebSocket 传输
    });
  },

  // 原型对象
  prototype: io(), // 使用默认的 socket.io 实例作为原型

  // WebSocket 状态常量
  CONNECTING: 0, // 连接中
  OPEN: 1, // 已连接
  CLOSING: 2, // 关闭中
  CLOSED: 3, // 已关闭
};

export default SocketPolyfill1;