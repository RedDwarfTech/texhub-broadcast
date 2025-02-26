const persistenceDir = process.env.YPERSISTENCE;
// @ts-ignore
import { LeveldbPersistence } from "y-leveldb";
const ldb = new LeveldbPersistence(persistenceDir);

// 遍历所有 key 的函数
export async function iterateAllKeys(): Promise<void> {
  // 创建一个 key 流
  const keyStream = ldb.createKeyStream();

  // 监听数据事件，获取每个 key
  keyStream.on('data', (key: string) => {
    console.log('Key:', key);
  });

  // 监听结束事件
  keyStream.on('end', () => {
    console.log('All keys have been iterated.');
  });

  // 监听错误事件
  keyStream.on('error', (err: Error) => {
    console.error('Error:', err);
  });
}