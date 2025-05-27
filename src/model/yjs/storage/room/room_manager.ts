import { Y } from "rdyjs";
import { WSSharedDoc } from "../sync/ws_shared_doc.js";

// 定义房间接口
export interface Room {
  id: string;           // 房间唯一标识
  name: string;         // 房间名称
  docName: string;      // 关联的文档名称
  ydoc: Y.Doc;         // Y.Doc实例
  createdAt: Date;     // 创建时间
  updatedAt: Date;     // 最后更新时间
  isActive: boolean;   // 房间是否活跃
  connections: Set<string>; // 存储连接ID而不是Socket对象
}

// 全局房间管理器
class RoomManager {
  private rooms: Map<string, Room>;
  private docs: Map<string, WSSharedDoc>; // 缓存WSSharedDoc实例

  constructor() {
    this.rooms = new Map();
    this.docs = new Map();
  }

  // 创建新房间
  createRoom(id: string, name: string, docName: string): Room {
    const room: Room = {
      id,
      name,
      docName,
      ydoc: new Y.Doc(),
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      connections: new Set()
    };
    this.rooms.set(id, room);
    return room;
  }

  // 获取房间
  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  // 删除房间
  deleteRoom(id: string): boolean {
    const room = this.rooms.get(id);
    if (room) {
      // 清理相关的WSSharedDoc实例
      this.docs.delete(room.docName);
      return this.rooms.delete(id);
    }
    return false;
  }

  // 获取所有房间
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  // 获取活跃房间
  getActiveRooms(): Room[] {
    return this.getAllRooms().filter(room => room.isActive);
  }

  // 更新房间状态
  updateRoomStatus(id: string, isActive: boolean): boolean {
    const room = this.rooms.get(id);
    if (room) {
      room.isActive = isActive;
      room.updatedAt = new Date();
      return true;
    }
    return false;
  }

  // 获取或创建WSSharedDoc实例
  getYDoc(docName: string): WSSharedDoc {
    let doc = this.docs.get(docName);
    if (!doc) {
      doc = new WSSharedDoc(docName);
      this.docs.set(docName, doc);
    }
    return doc;
  }

  // 添加连接
  addConnection(roomId: string, connectionId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.connections.add(connectionId);
      room.updatedAt = new Date();
      return true;
    }
    return false;
  }

  // 移除连接
  removeConnection(roomId: string, connectionId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.connections.delete(connectionId);
      room.updatedAt = new Date();
      // 如果没有活跃连接，可以考虑清理房间
      if (room.connections.size === 0) {
        this.updateRoomStatus(roomId, false);
      }
      return true;
    }
    return false;
  }

  // 获取房间的所有连接
  getRoomConnections(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.connections) : [];
  }
}

// 导出单例实例
export const roomManager = new RoomManager(); 