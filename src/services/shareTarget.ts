const SHARE_DATABASE = "bnotes-share-target";
const SHARE_STORE = "attachments";

interface StoredAttachment {
  id: string;
  file: Blob;
  name: string;
  type: string;
}

function openShareDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function takeSharedAttachment(id: string): Promise<File | null> {
  const database = await openShareDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SHARE_STORE, "readwrite");
    const store = transaction.objectStore(SHARE_STORE);
    const request = store.get(id);
    let file: File | null = null;

    request.onsuccess = () => {
      const attachment = request.result as StoredAttachment | undefined;
      if (
        attachment &&
        attachment.file instanceof Blob &&
        typeof attachment.name === "string" &&
        typeof attachment.type === "string"
      ) {
        file =
          attachment.file instanceof File
            ? attachment.file
            : new File([attachment.file], attachment.name, {
                type: attachment.type,
              });
        store.delete(id);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve(file);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
