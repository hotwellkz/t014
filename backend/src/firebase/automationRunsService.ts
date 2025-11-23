import { getFirestore } from "./admin";
import { AutomationRun, AutomationEvent } from "../models/automationRun";
import * as admin from "firebase-admin";

const RUNS_COLLECTION = "automationRuns";
const EVENTS_COLLECTION = "automationEvents";

/**
 * Создать новый запуск автоматизации
 */
export async function createAutomationRun(
  run: Omit<AutomationRun, "id">
): Promise<AutomationRun> {
  try {
    const db = getFirestore();
    const runRef = db.collection(RUNS_COLLECTION).doc();

    const runData: Omit<AutomationRun, "id"> = {
      ...run,
      startedAt: run.startedAt || admin.firestore.Timestamp.now(),
    };

    await runRef.set(runData);

    const createdRun: AutomationRun = {
      id: runRef.id,
      ...runData,
    };

    console.log(`[AutomationRuns] ✅ Created run: ${createdRun.id}`);
    return createdRun;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AutomationRuns] ❌ Error creating run:", errorMessage);
    throw new Error(
      `Ошибка создания запуска автоматизации: ${errorMessage}`
    );
  }
}

/**
 * Обновить запуск автоматизации
 */
export async function updateAutomationRun(
  runId: string,
  updates: Partial<AutomationRun>
): Promise<AutomationRun | null> {
  try {
    const db = getFirestore();
    const runRef = db.collection(RUNS_COLLECTION).doc(runId);

    const doc = await runRef.get();
    if (!doc.exists) {
      return null;
    }

    // Удаляем id из updates, если он там есть
    const { id: _, ...updateData } = updates as any;

    // Firestore не поддерживает undefined, конвертируем в null
    const cleanedData: any = {};
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        cleanedData[key] = value;
      }
    }

    if (Object.keys(cleanedData).length > 0) {
      await runRef.update(cleanedData);
    }

    const updatedDoc = await runRef.get();
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as AutomationRun;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AutomationRuns] ❌ Error updating run ${runId}:`, errorMessage);
    throw new Error(`Ошибка обновления запуска: ${errorMessage}`);
  }
}

/**
 * Получить запуск по ID
 */
export async function getAutomationRun(
  runId: string
): Promise<AutomationRun | null> {
  try {
    const db = getFirestore();
    const doc = await db.collection(RUNS_COLLECTION).doc(runId).get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data(),
    } as AutomationRun;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AutomationRuns] ❌ Error getting run ${runId}:`, errorMessage);
    throw new Error(`Ошибка получения запуска: ${errorMessage}`);
  }
}

/**
 * Получить последние N запусков
 */
export async function getRecentAutomationRuns(
  limit: number = 20
): Promise<AutomationRun[]> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(RUNS_COLLECTION)
      .orderBy("startedAt", "desc")
      .limit(limit)
      .get();

    const runs: AutomationRun[] = [];
    snapshot.forEach((doc) => {
      runs.push({
        id: doc.id,
        ...doc.data(),
      } as AutomationRun);
    });

    return runs;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AutomationRuns] ❌ Error getting recent runs:", errorMessage);
    throw new Error(`Ошибка получения запусков: ${errorMessage}`);
  }
}

/**
 * Создать событие автоматизации
 */
export async function createAutomationEvent(
  event: Omit<AutomationEvent, "createdAt">
): Promise<AutomationEvent> {
  try {
    const db = getFirestore();
    const eventRef = db.collection(EVENTS_COLLECTION).doc();

    const eventData: AutomationEvent = {
      ...event,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await eventRef.set(eventData);

    const createdEvent: AutomationEvent = {
      ...eventData,
    };

    return createdEvent;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AutomationEvents] ❌ Error creating event:", errorMessage);
    // Не пробрасываем ошибку, чтобы не ломать автоматизацию
    throw error;
  }
}

/**
 * Получить события для конкретного запуска
 */
export async function getAutomationEvents(
  runId: string,
  limit: number = 50
): Promise<AutomationEvent[]> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(EVENTS_COLLECTION)
      .where("runId", "==", runId)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    const events: AutomationEvent[] = [];
    snapshot.forEach((doc) => {
      events.push({
        ...doc.data(),
      } as AutomationEvent);
    });

    return events;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[AutomationEvents] ❌ Error getting events for run ${runId}:`,
      errorMessage
    );
    throw new Error(`Ошибка получения событий: ${errorMessage}`);
  }
}

/**
 * Получить последний успешный запуск
 */
export async function getLastSuccessfulRun(): Promise<AutomationRun | null> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(RUNS_COLLECTION)
      .where("status", "==", "success")
      .orderBy("startedAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as AutomationRun;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      "[AutomationRuns] ❌ Error getting last successful run:",
      errorMessage
    );
    return null;
  }
}

