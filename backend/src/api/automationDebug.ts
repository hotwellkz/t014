import { Router, Request, Response } from "express";
import {
  getRecentAutomationRuns,
  getAutomationRun,
  getAutomationEvents,
  getLastSuccessfulRun,
} from "../firebase/automationRunsService";
import { getAllChannels } from "../models/channel";
import { DEFAULT_TIMEZONE } from "../utils/automationSchedule";

const router = Router();

/**
 * GET /api/automation/debug/runs
 * Возвращает последние N запусков автоматизации
 */
router.get("/runs", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getRecentAutomationRuns(limit);

    // Конвертируем Timestamp в ISO строки для JSON
    const runsDTO = runs.map((run) => ({
      id: run.id,
      startedAt: run.startedAt.toDate().toISOString(),
      finishedAt: run.finishedAt?.toDate().toISOString() || null,
      status: run.status,
      schedulerInvocationAt: run.schedulerInvocationAt?.toDate().toISOString() || null,
      channelsPlanned: run.channelsPlanned,
      channelsProcessed: run.channelsProcessed,
      jobsCreated: run.jobsCreated,
      errorsCount: run.errorsCount,
      lastErrorMessage: run.lastErrorMessage || null,
      timezone: run.timezone,
    }));

    res.json(runsDTO);
  } catch (error: any) {
    console.error("[AutomationDebug] Error getting runs:", error);
    res.status(500).json({
      error: "Ошибка при получении запусков",
      message: error.message,
    });
  }
});

/**
 * GET /api/automation/debug/run/:runId
 * Возвращает детали конкретного запуска и его события
 */
router.get("/run/:runId", async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const run = await getAutomationRun(runId);
    if (!run) {
      return res.status(404).json({
        error: "Запуск не найден",
      });
    }

    const events = await getAutomationEvents(runId, limit);

    // Конвертируем Timestamp в ISO строки для JSON
    const runDTO = {
      id: run.id,
      startedAt: run.startedAt.toDate().toISOString(),
      finishedAt: run.finishedAt?.toDate().toISOString() || null,
      status: run.status,
      schedulerInvocationAt: run.schedulerInvocationAt?.toDate().toISOString() || null,
      channelsPlanned: run.channelsPlanned,
      channelsProcessed: run.channelsProcessed,
      jobsCreated: run.jobsCreated,
      errorsCount: run.errorsCount,
      lastErrorMessage: run.lastErrorMessage || null,
      timezone: run.timezone,
    };

    const eventsDTO = events.map((event) => ({
      runId: event.runId,
      createdAt: event.createdAt.toDate().toISOString(),
      level: event.level,
      step: event.step,
      channelId: event.channelId || null,
      channelName: event.channelName || null,
      message: event.message,
      details: event.details || null,
    }));

    res.json({
      run: runDTO,
      events: eventsDTO,
    });
  } catch (error: any) {
    console.error(`[AutomationDebug] Error getting run ${req.params.runId}:`, error);
    res.status(500).json({
      error: "Ошибка при получении запуска",
      message: error.message,
    });
  }
});

/**
 * GET /api/automation/debug/system
 * Возвращает системную информацию об автоматизации
 */
router.get("/system", async (req: Request, res: Response) => {
  try {
    const channels = await getAllChannels();
    
    // Детальное логирование для диагностики
    console.log(`[AutomationDebug] Total channels: ${channels.length}`);
    channels.forEach((ch) => {
      if (ch.automation) {
        console.log(
          `[AutomationDebug] Channel ${ch.id} (${ch.name}): automation.enabled=${ch.automation.enabled}, type=${typeof ch.automation.enabled}`
        );
      }
    });
    
    const enabledChannels = channels.filter(
      (ch) => ch.automation?.enabled === true
    );
    
    console.log(
      `[AutomationDebug] Enabled channels: ${enabledChannels.length} (${enabledChannels.map(c => `${c.id} (${c.name})`).join(', ')})`
    );

    const lastSuccessfulRun = await getLastSuccessfulRun();

    // Получаем информацию о часовом поясе
    const timezone = DEFAULT_TIMEZONE;
    const timezoneOffset = new Date().toLocaleString("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    });

    // Вычисляем время последнего успешного запуска
    let lastSuccessfulRunTime: string | null = null;
    if (lastSuccessfulRun) {
      lastSuccessfulRunTime = lastSuccessfulRun.startedAt.toDate().toISOString();
    }

    res.json({
      timezone,
      timezoneDisplay: `${timezone} (${timezoneOffset.split(" ").pop() || ""})`,
      automationEnabled: enabledChannels.length > 0,
      enabledChannelsCount: enabledChannels.length,
      lastSuccessfulRunTime,
      schedulerJobId: "automation-run-scheduled", // Из документации
      schedulerSchedule: "*/5 * * * *", // Каждые 5 минут
      schedulerTimezone: "Asia/Almaty",
    });
  } catch (error: any) {
    console.error("[AutomationDebug] Error getting system info:", error);
    res.status(500).json({
      error: "Ошибка при получении системной информации",
      message: error.message,
    });
  }
});

/**
 * GET /api/automation/debug/run-details?runId=XXXX
 * Возвращает детальную информацию о запуске: каналы и задачи
 */
router.get("/run-details", async (req: Request, res: Response) => {
  try {
    const { runId } = req.query;
    
    if (!runId || typeof runId !== "string") {
      return res.status(400).json({
        error: "Требуется параметр runId",
      });
    }
    
    console.log(`[AutomationDebug] Getting run details for runId: ${runId}`);
    
    const { getAutomationRun, getAutomationEvents } = await import("../firebase/automationRunsService");
    
    const run = await getAutomationRun(runId);
    if (!run) {
      console.log(`[AutomationDebug] Run ${runId} not found`);
      return res.status(404).json({
        error: "Запуск не найден",
      });
    }
    
    console.log(`[AutomationDebug] Run found: ${run.id}, status: ${run.status}`);
    
    // Получаем события для дополнительной информации
    let events: any[] = [];
    try {
      events = await getAutomationEvents(runId, 100);
      console.log(`[AutomationDebug] Found ${events.length} events`);
    } catch (eventsError: any) {
      console.error(`[AutomationDebug] Error getting events:`, eventsError);
      // Продолжаем без событий, это не критично
    }
    
    // Конвертируем Timestamp в ISO строки
    const convertTimestamp = (ts: any): string | null => {
      try {
        if (!ts) return null;
        if (ts.toDate && typeof ts.toDate === 'function') {
          return ts.toDate().toISOString();
        }
        if (ts instanceof Date) {
          return ts.toISOString();
        }
        if (typeof ts === 'number') {
          return new Date(ts).toISOString();
        }
        // Если это объект Firestore Timestamp
        if (ts.seconds !== undefined && ts.nanoseconds !== undefined) {
          return new Date(ts.seconds * 1000 + ts.nanoseconds / 1000000).toISOString();
        }
        return null;
      } catch (err: any) {
        console.warn(`[AutomationDebug] Error converting timestamp:`, err);
        return null;
      }
    };
    
    // Безопасно конвертируем channels
    let channelsDTO: any[] = [];
    try {
      if (Array.isArray(run.channels)) {
        channelsDTO = run.channels.map((ch: any) => {
          try {
            return {
              channelId: ch.channelId || null,
              channelName: ch.channelName || null,
              auto: ch.auto ?? false,
              shouldRunNow: ch.shouldRunNow ?? false,
              reason: ch.reason || 'unknown',
              details: {
                ...(ch.details || {}),
                now: ch.details?.now ? convertTimestamp(ch.details.now) : ch.details?.now || null,
                lastRunAt: ch.details?.lastRunAt ? convertTimestamp(ch.details.lastRunAt) : ch.details?.lastRunAt || null,
                targetTime: ch.details?.targetTime || null,
                timeMatched: ch.details?.timeMatched ?? null,
                dayMatched: ch.details?.dayMatched ?? null,
                minutesSinceLastRun: ch.details?.minutesSinceLastRun ?? null,
                frequencyLimit: ch.details?.frequencyLimit ?? null,
                timezone: ch.details?.timezone || null,
              },
            };
          } catch (chErr: any) {
            console.warn(`[AutomationDebug] Error processing channel ${ch.channelId}:`, chErr);
            return {
              channelId: ch.channelId || null,
              channelName: ch.channelName || null,
              error: 'Error processing channel data',
            };
          }
        });
      }
    } catch (channelsError: any) {
      console.error(`[AutomationDebug] Error processing channels:`, channelsError);
      channelsDTO = [];
    }
    
    // Безопасно конвертируем tasks
    let tasksDTO: any[] = [];
    try {
      if (Array.isArray(run.tasks)) {
        tasksDTO = run.tasks.map((task: any) => {
          try {
            return {
              taskId: task.taskId || null,
              channelId: task.channelId || null,
              channelName: task.channelName || null,
              status: task.status || 'unknown',
              error: task.error || null,
              createdAt: task.createdAt ? convertTimestamp(task.createdAt) : null,
            };
          } catch (taskErr: any) {
            console.warn(`[AutomationDebug] Error processing task ${task.taskId}:`, taskErr);
            return {
              taskId: task.taskId || null,
              error: 'Error processing task data',
            };
          }
        });
      }
    } catch (tasksError: any) {
      console.error(`[AutomationDebug] Error processing tasks:`, tasksError);
      tasksDTO = [];
    }
    
    // Безопасно конвертируем events
    const eventsDTO = events.map((event: any) => {
      try {
        let createdAt: string | null = null;
        if (event.createdAt) {
          if (event.createdAt.toDate && typeof event.createdAt.toDate === 'function') {
            createdAt = event.createdAt.toDate().toISOString();
          } else {
            createdAt = convertTimestamp(event.createdAt);
          }
        }
        
        return {
          runId: event.runId || null,
          createdAt: createdAt,
          level: event.level || 'info',
          step: event.step || 'other',
          channelId: event.channelId || null,
          channelName: event.channelName || null,
          message: event.message || '',
          details: event.details || null,
        };
      } catch (eventErr: any) {
        console.warn(`[AutomationDebug] Error processing event:`, eventErr);
        return {
          runId: event.runId || null,
          error: 'Error processing event data',
        };
      }
    });
    
    const response = {
      runId: run.id || null,
      startedAt: convertTimestamp(run.startedAt),
      finishedAt: convertTimestamp(run.finishedAt),
      status: run.status || 'unknown',
      channelsPlanned: run.channelsPlanned ?? 0,
      channelsProcessed: run.channelsProcessed ?? 0,
      jobsCreated: run.jobsCreated ?? 0,
      errorsCount: run.errorsCount ?? 0,
      lastErrorMessage: run.lastErrorMessage || null,
      timezone: run.timezone || 'Asia/Almaty',
      channels: channelsDTO,
      tasks: tasksDTO,
      events: eventsDTO,
    };
    
    console.log(`[AutomationDebug] ✅ Successfully prepared response for run ${runId}`);
    
    res.json(response);
  } catch (error: any) {
    console.error("[AutomationDebug] ❌ Error getting run details:", error);
    console.error("[AutomationDebug] Error stack:", error.stack);
    res.status(500).json({
      error: "Ошибка при получении деталей запуска",
      message: error.message || String(error),
      details: error.stack ? error.stack.substring(0, 500) : undefined,
    });
  }
});

export default router;

