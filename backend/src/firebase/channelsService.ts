import { getFirestore } from "./admin";
import { Channel } from "../models/channel";

const COLLECTION_NAME = "channels";

/**
 * Получить все каналы из Firestore
 */
export async function getAllChannels(): Promise<Channel[]> {
  try {
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTION_NAME).get();
    
    const channels: Channel[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Нормализуем automation.enabled (может быть строкой "true"/"false" или boolean)
      let automation = data.automation;
      if (automation && typeof automation.enabled === 'string') {
        automation = {
          ...automation,
          enabled: automation.enabled === 'true' || automation.enabled === '1',
        };
      }
      
      const channel: Channel = {
        id: doc.id,
        name: data.name || "",
        description: data.description || "",
        language: data.language || "ru",
        durationSeconds: data.durationSeconds || 8,
        ideaPromptTemplate: data.ideaPromptTemplate || "",
        videoPromptTemplate: data.videoPromptTemplate || "",
        gdriveFolderId: data.gdriveFolderId || null,
        externalUrl: data.externalUrl || undefined,
        automation: automation || undefined,
      };
      
      // Логирование для диагностики автоматизации
      if (channel.automation) {
        console.log(
          `[Firebase] Channel ${doc.id} (${channel.name}): automation exists, enabled=${channel.automation.enabled} (${typeof channel.automation.enabled})`
        );
      }
      
      channels.push(channel);
    });

    console.log(`[Firebase] ✅ Получено ${channels.length} каналов`);
    return channels;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Firebase] ❌ Error getting channels:", errorMessage);
    console.error("[Firebase] ❌ Error stack:", error instanceof Error ? error.stack : "No stack");
    
    // Если Firebase не настроен или любая другая ошибка, возвращаем пустой массив
    // Это предотвращает закрытие соединения и позволяет фронтенду обработать ситуацию
    if (errorMessage.includes("Firebase не инициализирован") || 
        errorMessage.includes("FIREBASE_") ||
        errorMessage.includes("Firebase не инициализирован")) {
      console.warn("[Firebase] ⚠️  Firebase не настроен, возвращаем пустой массив каналов");
      return [];
    }
    
    // Для любых других ошибок также возвращаем пустой массив, чтобы не ломать фронтенд
    console.warn("[Firebase] ⚠️  Ошибка получения каналов, возвращаем пустой массив:", errorMessage);
    return [];
  }
}

/**
 * Получить канал по ID
 */
export async function getChannelById(id: string): Promise<Channel | undefined> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    
    if (!doc.exists) {
      return undefined;
    }

    const data = doc.data();
    if (!data) {
      return undefined;
    }

    // Нормализуем automation.enabled (может быть строкой "true"/"false" или boolean)
    if (data.automation && typeof data.automation === 'object') {
      const automation = data.automation as any;
      if (automation.enabled !== undefined) {
        automation.enabled = automation.enabled === true || automation.enabled === 'true' || automation.enabled === '1';
      }
    }

    return {
      id: doc.id,
      ...data,
    } as Channel;
  } catch (error: unknown) {
    console.error(`[Firebase] Error getting channel ${id}:`, error);
    throw new Error(`Ошибка получения канала: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Создать канал в Firestore
 */
export async function createChannel(channel: Channel): Promise<Channel> {
  try {
    const db = getFirestore();
    const channelRef = db.collection(COLLECTION_NAME).doc(channel.id);
    
    await channelRef.set({
      name: channel.name,
      description: channel.description,
      language: channel.language,
      durationSeconds: channel.durationSeconds,
      ideaPromptTemplate: channel.ideaPromptTemplate,
      videoPromptTemplate: channel.videoPromptTemplate,
      gdriveFolderId: channel.gdriveFolderId || null,
      externalUrl: channel.externalUrl || null,
      automation: channel.automation || null,
    });

    console.log(`[Firebase] ✅ Channel created: ${channel.id}`);
    return channel;
  } catch (error: unknown) {
    console.error(`[Firebase] Error creating channel ${channel.id}:`, error);
    throw new Error(`Ошибка создания канала: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Обновить канал в Firestore
 */
export async function updateChannel(id: string, updates: Partial<Channel>): Promise<Channel | null> {
  try {
    const db = getFirestore();
    const channelRef = db.collection(COLLECTION_NAME).doc(id);
    
    const doc = await channelRef.get();
    if (!doc.exists) {
      return null;
    }

    // Удаляем id из updates, если он там есть (id не обновляется)
    const { id: _, ...updateData } = updates as any;
    
    // Удаляем все undefined значения, так как Firestore не принимает undefined
    const cleanedData: any = {};
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        // Если это пустая строка для externalUrl, преобразуем в null
        if (key === 'externalUrl' && value === '') {
          cleanedData[key] = null;
        } else {
          cleanedData[key] = value;
        }
      }
    }
    
    // Если нет данных для обновления, возвращаем текущий документ
    if (Object.keys(cleanedData).length === 0) {
      return {
        id: doc.id,
        ...doc.data(),
      } as Channel;
    }
    
    await channelRef.update(cleanedData);

    const updatedDoc = await channelRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Channel;
  } catch (error: unknown) {
    console.error(`[Firebase] Error updating channel ${id}:`, error);
    throw new Error(`Ошибка обновления канала: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Удалить канал из Firestore
 */
export async function deleteChannel(id: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const channelRef = db.collection(COLLECTION_NAME).doc(id);
    
    const doc = await channelRef.get();
    if (!doc.exists) {
      return false;
    }

    await channelRef.delete();
    console.log(`[Firebase] ✅ Channel deleted: ${id}`);
    return true;
  } catch (error: unknown) {
    console.error(`[Firebase] Error deleting channel ${id}:`, error);
    throw new Error(`Ошибка удаления канала: ${error instanceof Error ? error.message : String(error)}`);
  }
}

