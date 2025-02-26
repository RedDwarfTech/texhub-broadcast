// @ts-ignore
import levelup from "levelup";
// @ts-ignore
import leveldown from "leveldown";
const persistenceDir = process.env.YPERSISTENCE;
var db = levelup(leveldown(persistenceDir))

export async function iterateAllKeys(): Promise<void> {
  const keyStream = db.createKeyStream();

  keyStream.on('data', (key: string) => {
    console.log('Key:', key);
  });

  keyStream.on('end', () => {
    console.log('All keys have been iterated.');
  });

  keyStream.on('error', (err: Error) => {
    console.error('Error:', err);
  });
}