import { Router, Request, Response } from "express";
import { getAllChannels, getChannelById, Channel } from "../models/channel";
import { createJob, countActiveJobs } from "../models/videoJob";
import { generateIdeas } from "../services/openaiService";
import { generateVeoPrompt } from "../services/openaiService";
import {
  getCurrentTimeComponentsInTimezone,
  getDayOfWeekInTimezone,
  DEFAULT_TIMEZONE,
  formatDateInTimezone,
} from "../utils/automationSchedule";
import { createAutomationLogger, AutomationLogger } from "../utils/automationLogger";
import * as admin from "firebase-admin";

const router = Router();

/**
 * Проверяет, нужно ли запускать автоматизацию для канала в текущее время
 * Использует timezone из настроек канала или Asia/Almaty по умолчанию
 * Возвращает объект с результатом проверки и причинами пропуска
 */
interface AutomationCheckResult {
  shouldRun: boolean;
  reasons: string[];
  details?: Record<string, any>;
}

async function shouldRunAutomation(
  channel: Channel,
  intervalMinutes: number = 10
): Promise<AutomationCheckResult> {
  const reasons: string[] = [];
  const details: Record<string, any> = {};

  if (!channel.automation || !channel.automation.enabled) {
    reasons.push("automation_disabled_or_missing");
    return { shouldRun: false, reasons, details };
  }

  const automation = channel.automation;
  const timezone = automation.timeZone || DEFAULT_TIMEZONE;
  details.timezone = timezone;

  // Проверяем, не выполняется ли уже автоматизация
  if (automation.isRunning) {
    reasons.push("already_running");
    details.isRunning = true;
    return { shouldRun: false, reasons, details };
  }

  // Получаем текущее время в указанном timezone
  const currentTimeComponents = getCurrentTimeComponentsInTimezone(timezone);
  const currentTimeUTC = new Date();
  const currentTimeString = formatDateInTimezone(currentTimeUTC.getTime(), timezone);
  details.currentTime = currentTimeString;
  details.currentTimeComponents = currentTimeComponents;

  // Проверяем день недели в указанном timezone
  const [currentDay, currentDayNumber] = getDayOfWeekInTimezone(
    currentTimeUTC,
    timezone
  );
  const isDayMatch =
    automation.daysOfWeek.includes(currentDay) ||
    automation.daysOfWeek.includes(currentDayNumber);
  
  details.currentDay = currentDay;
  details.currentDayNumber = currentDayNumber;
  details.allowedDays = automation.daysOfWeek;
  
  if (!isDayMatch) {
    reasons.push("day_not_allowed");
    return { shouldRun: false, reasons, details };
  }

  // Проверяем лимит активных задач
  const activeJobsCount = await countActiveJobs(channel.id);
  const maxActive = automation.maxActiveTasks || 2;
  details.activeJobsCount = activeJobsCount;
  details.maxActiveTasks = maxActive;
  
  if (activeJobsCount >= maxActive) {
    reasons.push("max_active_jobs_reached");
    return { shouldRun: false, reasons, details };
  }

  // Проверяем время
  const currentHour = currentTimeComponents.hour;
  const currentMinute = currentTimeComponents.minute;
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  details.scheduledTimes = automation.times;
  details.lastRunAt = automation.lastRunAt;

  // Проверяем, есть ли запланированное время в интервале
  let foundMatchingTime = false;
  let matchingTimeDetails: any = null;

  for (const scheduledTime of automation.times) {
    if (!scheduledTime || scheduledTime.trim() === "") {
      continue;
    }

    const [scheduledHour, scheduledMinute] = scheduledTime
      .split(":")
      .map(Number);

    const scheduledTotalMinutes = scheduledHour * 60 + scheduledMinute;
    const diffMinutes = currentTotalMinutes - scheduledTotalMinutes;

    // Проверяем, что время уже наступило и в пределах интервала (коридор после запланированного времени)
    // Scheduler запускается каждые 5 минут, поэтому нужен коридор после запланированного времени
    // diffMinutes >= 0 означает, что запланированное время уже прошло
    // diffMinutes <= intervalMinutes означает, что мы ещё в пределах допустимого интервала
    if (diffMinutes >= 0 && diffMinutes <= intervalMinutes) {
      // Проверяем, не было ли уже запуска сегодня для этого времени
      let alreadyRanToday = false;
      
      if (automation.lastRunAt) {
        const lastRunDate = new Date(automation.lastRunAt);
        const lastRunFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const lastRunParts = lastRunFormatter.formatToParts(lastRunDate);
        const lastRunYear = parseInt(lastRunParts.find((p) => p.type === "year")!.value);
        const lastRunMonth = parseInt(lastRunParts.find((p) => p.type === "month")!.value) - 1;
        const lastRunDay = parseInt(lastRunParts.find((p) => p.type === "day")!.value);
        const lastRunHour = parseInt(lastRunParts.find((p) => p.type === "hour")!.value);
        const lastRunMinute = parseInt(lastRunParts.find((p) => p.type === "minute")!.value);

        // Если последний запуск был сегодня и для этого же времени - пропускаем
        if (
          lastRunYear === currentTimeComponents.year &&
          lastRunMonth === currentTimeComponents.month &&
          lastRunDay === currentTimeComponents.day &&
          lastRunHour === scheduledHour &&
          lastRunMinute === scheduledMinute
        ) {
          alreadyRanToday = true;
          matchingTimeDetails = {
            scheduledTime,
            diffMinutes,
            alreadyRanToday: true,
            lastRunAt: automation.lastRunAt,
          };
          continue;
        }
      }

      // Нашли подходящее время, которое ещё не запускалось сегодня
      foundMatchingTime = true;
      matchingTimeDetails = {
        scheduledTime,
        diffMinutes,
        alreadyRanToday: false,
      };
      break;
    }
  }

  if (!foundMatchingTime) {
    reasons.push("time_not_due");
    details.matchingTimeDetails = matchingTimeDetails;
    return { shouldRun: false, reasons, details };
  }

  // Все проверки пройдены
  details.matchingTimeDetails = matchingTimeDetails;
  return { shouldRun: true, reasons: [], details };
}

/**
 * Получает список уже использованных идей для канала
 */
async function getUsedIdeasForChannel(channelId: string): Promise<string[]> {
  try {
    const { getAllJobs } = await import("../models/videoJob");
    const jobs = await getAllJobs();
    const channelJobs = jobs.filter((job) => job.channelId === channelId);
    return channelJobs
      .map((job) => job.ideaText)
      .filter((idea): idea is string => !!idea);
  } catch (error) {
    console.error(
      `[Automation] Error getting used ideas for channel ${channelId}:`,
      error
    );
    return [];
  }
}

/**
 * Создает автоматическую задачу генерации для канала
 * Экспортируем для использования в планировщике
 */
export async function createAutomatedJob(
  channel: Channel,
  logger?: AutomationLogger
): Promise<string | null> {
  const timezone = channel.automation?.timeZone || DEFAULT_TIMEZONE;
  const runId = `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    const timeString = formatDateInTimezone(Date.now(), timezone);
    
    console.log("─".repeat(80));
    console.log(`[Automation] 🚀 Creating automated job for channel: ${channel.id} (${channel.name})`);
    console.log(`[Automation] Run ID: ${runId}`);
    console.log(`[Automation] Timezone: ${timezone}, Current time: ${timeString}`);
    console.log(`[Automation] Schedule: ${channel.automation?.times.join(", ") || "none"}`);
    console.log(`[Automation] Days: ${channel.automation?.daysOfWeek.join(", ") || "none"}`);
    console.log("─".repeat(80));

    // Устанавливаем флаг isRunning
    const { updateChannel } = await import("../models/channel");
    await updateChannel(channel.id, {
      automation: {
        ...channel.automation!,
        isRunning: true,
        runId,
      },
    });

    // Проверяем лимит активных задач
    const activeCount = await countActiveJobs(channel.id);
    const maxActive = channel.automation?.maxActiveTasks || 2;
    if (activeCount >= maxActive) {
      console.log("─".repeat(80));
      console.log(`[Automation] ⚠️  SKIPPED: Channel ${channel.id} has ${activeCount} active jobs, max is ${maxActive}`);
      console.log("─".repeat(80));
      
      if (logger) {
        await logger.logEvent({
          level: "warn",
          step: "channel-check",
          channelId: channel.id,
          channelName: channel.name,
          message: `Пропущено: достигнут лимит активных задач (${activeCount}/${maxActive})`,
          details: { activeCount, maxActive },
        });
      }
      
      // Сбрасываем флаг isRunning перед выходом
      try {
        await updateChannel(channel.id, {
          automation: {
            ...channel.automation!,
            isRunning: false,
            runId: null,
          },
        });
        console.log(
          `[Automation] ✅ Reset isRunning flag for channel ${channel.id} (max active jobs reached)`
        );
      } catch (resetError) {
        console.error(
          `[Automation] ⚠️ Failed to reset isRunning flag for channel ${channel.id}:`,
          resetError
        );
      }
      return null;
    }

    // Шаг 1: Генерация идеи
    let ideas;
    try {
      if (logger) {
        await logger.logEvent({
          level: "info",
          step: "generate-idea",
          channelId: channel.id,
          channelName: channel.name,
          message: "Начинаю генерацию идеи",
        });
      }

      const usedIdeas =
        channel.automation?.useOnlyFreshIdeas === true
          ? await getUsedIdeasForChannel(channel.id)
          : [];
      ideas = await generateIdeas(channel, null, 5);

      // Фильтруем использованные идеи, если нужно
      if (channel.automation?.useOnlyFreshIdeas === true && usedIdeas.length > 0) {
        ideas = ideas.filter(
          (idea) =>
            !usedIdeas.some(
              (used) =>
                used.toLowerCase().includes(idea.title.toLowerCase()) ||
                used.toLowerCase().includes(idea.description.toLowerCase())
            )
        );
      }

      if (ideas.length === 0) {
        console.warn(
          `[Automation] No fresh ideas for channel ${channel.id}, using any available`
        );
        ideas = await generateIdeas(channel, null, 5);
      }

      if (ideas.length === 0) {
        throw new Error("Failed to generate ideas");
      }

      if (logger) {
        await logger.logEvent({
          level: "info",
          step: "generate-idea",
          channelId: channel.id,
          channelName: channel.name,
          message: `Идея сгенерирована: ${ideas[0]?.title || "N/A"}`,
          details: { ideasCount: ideas.length },
        });
      }
    } catch (error: any) {
      console.error(
        `[Automation] Error generating ideas for channel ${channel.id}:`,
        error
      );
      
      if (logger) {
        await logger.logEvent({
          level: "error",
          step: "generate-idea",
          channelId: channel.id,
          channelName: channel.name,
          message: "Ошибка генерации идеи",
          details: { error: error.message },
        });
      }
      
      throw error;
    }

    // Выбираем первую идею
    const selectedIdea = ideas[0];
    console.log(
      `[Automation] Selected idea for channel ${channel.id}: ${selectedIdea.title}`
    );

    // Шаг 2: Генерация промпта
    let veoPromptResult;
    try {
      if (logger) {
        await logger.logEvent({
          level: "info",
          step: "generate-prompt",
          channelId: channel.id,
          channelName: channel.name,
          message: "Начинаю генерацию промпта",
        });
      }

      veoPromptResult = await generateVeoPrompt(channel, {
        title: selectedIdea.title,
        description: selectedIdea.description,
      });

      if (logger) {
        await logger.logEvent({
          level: "info",
          step: "generate-prompt",
          channelId: channel.id,
          channelName: channel.name,
          message: "Промпт сгенерирован",
          details: { videoTitle: veoPromptResult.videoTitle },
        });
      }
    } catch (error: any) {
      console.error(
        `[Automation] Error generating prompt for channel ${channel.id}:`,
        error
      );
      
      if (logger) {
        await logger.logEvent({
          level: "error",
          step: "generate-prompt",
          channelId: channel.id,
          channelName: channel.name,
          message: "Ошибка генерации промпта",
          details: { error: error.message },
        });
      }
      
      throw error;
    }

    // Шаг 3: Создание задачи
    let job;
    try {
      if (logger) {
        await logger.logEvent({
          level: "info",
          step: "create-job",
          channelId: channel.id,
          channelName: channel.name,
          message: "Создаю задачу генерации видео",
        });
      }

      job = await createJob(
        veoPromptResult.veoPrompt,
        channel.id,
        channel.name,
        `${selectedIdea.title}: ${selectedIdea.description}`,
        veoPromptResult.videoTitle
      );

      console.log(
        `[Automation] ✅ Job document created in Firestore: ${job.id} for channel ${channel.id}`
      );

      // Помечаем задачу как автоматическую
      const { updateJob } = await import("../models/videoJob");
      await updateJob(job.id, { isAuto: true });

      if (logger) {
        logger.incrementJobsCreated();
        await logger.logEvent({
          level: "info",
          step: "create-job",
          channelId: channel.id,
          channelName: channel.name,
          message: "Задача создана успешно",
          details: { jobId: job.id, prompt: veoPromptResult.veoPrompt.substring(0, 100) },
        });
      }
    } catch (error: any) {
      console.error(
        `[Automation] Error creating job for channel ${channel.id}:`,
        error
      );
      
      if (logger) {
        await logger.logEvent({
          level: "error",
          step: "create-job",
          channelId: channel.id,
          channelName: channel.name,
          message: "Ошибка создания задачи",
          details: { error: error.message },
        });
      }
      
      throw error;
    }

    const duration = Date.now() - startTime;
    console.log("─".repeat(80));
    console.log(`[Automation] ✅ SUCCESS: Created automated job ${job.id} for channel ${channel.id}`);
    console.log(`[Automation] Duration: ${duration}ms`);
    console.log(`[Automation] Idea: ${selectedIdea.title}`);
    console.log(`[Automation] Video title: ${veoPromptResult.videoTitle}`);
    console.log("─".repeat(80));

    // Обновляем lastRunAt и пересчитываем nextRunAt только после успешного создания задачи
    const { calculateNextRunAt } = await import("../utils/automationSchedule");
    
    if (channel.automation) {
      try {
        const now = Date.now();
        const nextRunAt = calculateNextRunAt(
          channel.automation.times,
          channel.automation.daysOfWeek,
          timezone,
          now // Используем текущее время как lastRunAt для расчета следующего
        );
        
        await updateChannel(channel.id, {
          automation: {
            ...channel.automation,
            lastRunAt: now,
            nextRunAt,
            isRunning: true,
            runId,
          },
        });
        
        if (logger) {
          await logger.logEvent({
            level: "info",
            step: "update-channel-next-run",
            channelId: channel.id,
            channelName: channel.name,
            message: "Обновлено расписание следующего запуска",
            details: { nextRunAt: nextRunAt || null },
          });
        }
        
        if (nextRunAt) {
          const nextRunString = formatDateInTimezone(nextRunAt, timezone);
          console.log(
            `[Automation] ✅ Last run: ${timeString}, Next run scheduled for: ${nextRunString} (${timezone})`
          );
        } else {
          console.log(
            `[Automation] ⚠️ Last run: ${timeString}, but next run could not be calculated`
          );
        }
      } catch (error: any) {
        console.error(
          `[Automation] Error updating channel next run for ${channel.id}:`,
          error
        );
        
        if (logger) {
          await logger.logEvent({
            level: "error",
            step: "update-channel-next-run",
            channelId: channel.id,
            channelName: channel.name,
            message: "Ошибка обновления расписания",
            details: { error: error.message },
          });
        }
      }
    }

    // Отправляем уведомление в Telegram (если настроено)
    try {
      const telegramChatId = process.env.AUTOMATION_DEBUG_CHAT_ID;
      if (telegramChatId) {
        const { getTelegramClient } = await import("../telegram/client");
        const client = await getTelegramClient();
        if (client) {
          await client.sendMessage(telegramChatId, {
            message: `[AUTOMATION] Канал "${channel.name}" (${channel.id}), запущен автогонератор в ${timeString} (${timezone}). Статус: успех. Job ID: ${job.id}`,
          });
        }
      }
    } catch (telegramError) {
      console.warn("[Automation] Failed to send Telegram notification:", telegramError);
    }

    return job.id;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error("─".repeat(80));
    console.error(`[Automation] ❌ ERROR: Failed to create automated job for channel ${channel.id}`);
    console.error(`[Automation] Error: ${error.message}`);
    console.error(`[Automation] Stack: ${error.stack}`);
    console.error(`[Automation] Duration: ${duration}ms`);
    console.error("─".repeat(80));
    
    if (logger) {
      await logger.logEvent({
        level: "error",
        step: "other",
        channelId: channel.id,
        channelName: channel.name,
        message: `Критическая ошибка: ${error.message}`,
        details: { error: error.message, stack: error.stack?.substring(0, 500) },
      });
    }
    
    // Сбрасываем флаг isRunning при ошибке
    try {
      const { updateChannel } = await import("../models/channel");
      await updateChannel(channel.id, {
        automation: {
          ...channel.automation!,
          isRunning: false,
          runId: null,
        },
      });
    } catch (updateError) {
      console.error("[Automation] Failed to reset isRunning flag:", updateError);
    }
    
    // Отправляем уведомление об ошибке
    try {
      const telegramChatId = process.env.AUTOMATION_DEBUG_CHAT_ID;
      if (telegramChatId) {
        const { getTelegramClient } = await import("../telegram/client");
        const client = await getTelegramClient();
        if (client) {
          const timeString = formatDateInTimezone(Date.now(), timezone);
          await client.sendMessage(telegramChatId, {
            message: `[AUTOMATION] Канал "${channel.name}" (${channel.id}), ошибка при запуске автогонератора в ${timeString} (${timezone}). Ошибка: ${error.message}`,
          });
        }
      }
    } catch (telegramError) {
      // Игнорируем ошибки Telegram
    }
    
    return null;
  }
}

/**
 * POST /api/channels/:channelId/automation/run-now
 * Ручной запуск автоматизации для конкретного канала (независимо от расписания)
 */
router.post("/channels/:channelId/run-now", async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    
    console.log(`[Automation] Manual run requested for channel ${channelId}`);
    
    // Получаем канал
    const channel = await getChannelById(channelId);
    if (!channel) {
      return res.status(404).json({
        error: "Канал не найден",
      });
    }
    
    // Проверяем, включена ли автоматизация
    if (!channel.automation || !channel.automation.enabled) {
      return res.status(400).json({
        error: "Автоматизация не включена для этого канала",
      });
    }
    
    // Проверяем, не выполняется ли уже автоматизация
    if (channel.automation.isRunning) {
      return res.status(400).json({
        error: "Автоматизация уже выполняется для этого канала",
      });
    }
    
    // Запускаем автоматизацию (игнорируя проверку времени/дней недели)
    let jobId: string | null = null;
    try {
      jobId = await createAutomatedJob(channel);
    } catch (createError: any) {
      console.error(`[Automation] ❌ Error in createAutomatedJob for channel ${channelId}:`, createError);
      console.error(`[Automation] Error stack:`, createError.stack);
      
      // Убеждаемся, что флаг isRunning сброшен
      try {
        const { updateChannel } = await import("../models/channel");
        const currentChannel = await getChannelById(channelId);
        if (currentChannel?.automation?.isRunning) {
          await updateChannel(channelId, {
            automation: {
              ...currentChannel.automation,
              isRunning: false,
              runId: null,
            },
          });
          console.log(`[Automation] ✅ Reset isRunning flag after error for channel ${channelId}`);
        }
      } catch (resetError: any) {
        console.error(`[Automation] ⚠️ Failed to reset isRunning flag:`, resetError);
      }
      
      return res.status(500).json({
        error: "Ошибка при создании задачи автоматизации",
        message: createError.message || String(createError),
        details: createError.stack ? createError.stack.substring(0, 500) : undefined,
      });
    }
    
    if (!jobId) {
      return res.status(500).json({
        error: "Не удалось создать задачу автоматизации",
        message: "Возможно, достигнут лимит активных задач или произошла ошибка при генерации",
      });
    }
    
    console.log(`[Automation] ✅ Manual run completed for channel ${channelId}, job ${jobId}`);
    
    res.json({
      success: true,
      message: "Автоматизация запущена",
      jobId,
      channelId: channel.id,
      channelName: channel.name,
    });
  } catch (error: any) {
    console.error(`[Automation] ❌ Error in manual run for channel ${req.params.channelId}:`, error);
    console.error(`[Automation] Error stack:`, error.stack);
    
    // Убеждаемся, что флаг isRunning сброшен
    try {
      const { updateChannel } = await import("../models/channel");
      const currentChannel = await getChannelById(req.params.channelId);
      if (currentChannel?.automation?.isRunning) {
        await updateChannel(req.params.channelId, {
          automation: {
            ...currentChannel.automation,
            isRunning: false,
            runId: null,
          },
        });
        console.log(`[Automation] ✅ Reset isRunning flag after error for channel ${req.params.channelId}`);
      }
    } catch (resetError: any) {
      console.error(`[Automation] ⚠️ Failed to reset isRunning flag:`, resetError);
    }
    
    res.status(500).json({
      error: "Ошибка при запуске автоматизации",
      message: error.message || String(error),
      details: error.stack ? error.stack.substring(0, 500) : undefined,
    });
  }
});

/**
 * POST /api/automation/run-scheduled
 * Запускает автоматизацию для всех каналов, у которых наступило время
 * 
 * Этот endpoint должен вызываться Cloud Scheduler каждые 5 минут.
 * 
 * Настройка Cloud Scheduler:
 * gcloud scheduler jobs create http automation-run-scheduled
 *   --location=europe-central2
 *   --schedule="каждые 5 минут"
 *   --uri="https://YOUR_SERVICE_URL/api/automation/run-scheduled"
 *   --http-method=POST
 *   --time-zone="Asia/Almaty"
 * 
 * См. CLOUD_SCHEDULER_SETUP.md для подробной инструкции.
 */
router.post("/run-scheduled", async (req: Request, res: Response) => {
  const startTime = Date.now();
  let logger: AutomationLogger | undefined;
  
  try {
    const currentTimeUTC = new Date();
    const timeString = formatDateInTimezone(Date.now(), DEFAULT_TIMEZONE);
    
    console.log("=".repeat(80));
    console.log("[Automation] ===== SCHEDULED AUTOMATION CHECK STARTED =====");
    console.log(`[Automation] Triggered by: ${req.headers['user-agent'] || 'Unknown'}`);
    console.log(`[Automation] UTC time: ${currentTimeUTC.toISOString()}`);
    console.log(`[Automation] ${DEFAULT_TIMEZONE} time: ${timeString}`);
    console.log("=".repeat(80));
    
    const intervalMinutes = 10; // Интервал проверки (10 минут)

    // Получаем все каналы
    const channels = await getAllChannels();
    
    // Детальное логирование для диагностики
    console.log(`[Automation] Total channels loaded: ${channels.length}`);
    channels.forEach((ch) => {
      const hasAutomation = !!ch.automation;
      const isEnabled = ch.automation?.enabled === true;
      const hasTimes = ch.automation?.times && ch.automation.times.length > 0;
      const hasDays = ch.automation?.daysOfWeek && ch.automation.daysOfWeek.length > 0;
      console.log(
        `[Automation] Channel ${ch.id} (${ch.name}): automation=${hasAutomation}, enabled=${isEnabled}, times=${hasTimes}, days=${hasDays}`
      );
      if (ch.automation) {
        console.log(
          `[Automation]   Details: ${JSON.stringify({
            enabled: ch.automation.enabled,
            times: ch.automation.times,
            daysOfWeek: ch.automation.daysOfWeek,
            timeZone: ch.automation.timeZone,
          })}`
        );
      }
    });
    
    const enabledChannels = channels.filter(
      (ch) => ch.automation?.enabled === true
    );

    console.log(
      `[Automation] Found ${enabledChannels.length} channels with automation enabled: ${enabledChannels.map(c => `${c.id} (${c.name})`).join(', ')}`
    );

    // Создаем логгер для этого запуска
    logger = await createAutomationLogger(
      DEFAULT_TIMEZONE,
      enabledChannels.length,
      currentTimeUTC
    );

    await logger.logEvent({
      level: "info",
      step: "select-channels",
      message: `Найдено каналов с включённой автоматизацией: ${enabledChannels.length}`,
      details: { channelIds: enabledChannels.map((c) => c.id) },
    });

    const results: Array<{
      channelId: string;
      channelName: string;
      jobId: string | null;
      error?: string;
      timezone?: string;
    }> = [];

    for (const channel of enabledChannels) {
      try {
        const timezone = channel.automation?.timeZone || DEFAULT_TIMEZONE;
        
        // Всегда увеличиваем счётчик обработанных каналов для всех каналов с enabled=true
        logger.incrementChannelsProcessed();
        
        // Детальная проверка с логированием причин
        const checkResult = await shouldRunAutomation(channel, intervalMinutes);
        
        // Определяем причину пропуска
        let reason: "time_not_matched" | "day_not_allowed" | "task_already_exists" | "frequency_limit" | "disabled" | "already_running" | "ok" = "ok";
        if (!checkResult.shouldRun) {
          if (checkResult.reasons.includes("time_not_due")) {
            reason = "time_not_matched";
          } else if (checkResult.reasons.includes("day_not_allowed")) {
            reason = "day_not_allowed";
          } else if (checkResult.reasons.includes("max_active_jobs_reached")) {
            reason = "frequency_limit";
          } else if (checkResult.reasons.includes("already_running")) {
            reason = "already_running";
          } else if (checkResult.reasons.includes("automation_disabled_or_missing")) {
            reason = "disabled";
          }
        }
        
        // Создаём детальный объект проверки канала
        const channelCheck: import("../models/automationRun").ChannelCheckDetails = {
          channelId: channel.id,
          channelName: channel.name,
          auto: channel.automation?.enabled === true,
          shouldRunNow: checkResult.shouldRun,
          reason,
          details: {
            now: Date.now(),
            targetTime: checkResult.details?.matchingTimeDetails?.scheduledTime,
            timeMatched: checkResult.details?.matchingTimeDetails !== undefined && !checkResult.details?.matchingTimeDetails?.alreadyRanToday,
            dayMatched: checkResult.details?.currentDay && channel.automation?.daysOfWeek?.includes(checkResult.details.currentDay),
            lastRunAt: channel.automation?.lastRunAt || null,
            minutesSinceLastRun: channel.automation?.lastRunAt 
              ? (Date.now() - channel.automation.lastRunAt) / (1000 * 60)
              : undefined,
            frequencyLimit: checkResult.details?.activeJobsCount >= checkResult.details?.maxActiveTasks,
            activeJobsCount: checkResult.details?.activeJobsCount,
            maxActiveTasks: checkResult.details?.maxActiveTasks,
            timezone,
            scheduledTimes: channel.automation?.times,
            daysOfWeek: channel.automation?.daysOfWeek,
          },
        };
        
        // Сохраняем проверку канала в logger
        logger.addChannelCheck(channelCheck);
        
        console.log(`[Automation] Channel ${channel.id} (${channel.name}) check:`, {
          shouldRun: checkResult.shouldRun,
          reasons: checkResult.reasons,
          reason,
          details: checkResult.details,
        });
        
        await logger.logEvent({
          level: "info",
          step: "channel-check",
          channelId: channel.id,
          channelName: channel.name,
          message: checkResult.shouldRun 
            ? "Канал готов к запуску автоматизации" 
            : `Канал пропущен: ${checkResult.reasons.join(", ")}`,
          details: checkResult.details,
        });
        
        if (checkResult.shouldRun) {
          console.log(
            `[Automation] ✅ Channel ${channel.id} (${channel.name}) should run automation (timezone: ${timezone})`
          );
          
          const jobId = await createAutomatedJob(channel, logger);
          
          if (jobId) {
            console.log(
              `[Automation] ✅ Job created for channel ${channel.id}: ${jobId}`
            );
            
            // Сохраняем задачу в logger
            const task: import("../models/automationRun").AutomationTask = {
              taskId: jobId,
              channelId: channel.id,
              channelName: channel.name,
              status: "pending",
              error: null,
              createdAt: admin.firestore.Timestamp.now(),
            };
            logger.addTask(task);
          } else {
            console.log(
              `[Automation] ⚠️ Job creation returned null for channel ${channel.id}`
            );
            
            // Сохраняем задачу с ошибкой
            const task: import("../models/automationRun").AutomationTask = {
              taskId: "failed",
              channelId: channel.id,
              channelName: channel.name,
              status: "error",
              error: "Job creation returned null",
              createdAt: admin.firestore.Timestamp.now(),
            };
            logger.addTask(task);
          }
          
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            jobId,
            timezone,
          });
        } else {
          console.log(
            `[Automation] ⏭️  Channel ${channel.id} (${channel.name}) skipped: ${checkResult.reasons.join(", ")}`
          );
          
          // Если канал пропущен из-за already_running, но прошло больше 30 минут с последнего запуска,
          // сбрасываем флаг (защита от зависших флагов)
          if (checkResult.reasons.includes("already_running")) {
            const { updateChannel } = await import("../models/channel");
            const channelData = await getChannelById(channel.id);
            
            if (channelData?.automation?.lastRunAt) {
              const lastRunTime = channelData.automation.lastRunAt;
              const now = Date.now();
              const minutesSinceLastRun = (now - lastRunTime) / (1000 * 60);
              
              // Если прошло больше 30 минут, считаем что автоматизация зависла
              if (minutesSinceLastRun > 30) {
                try {
                  await updateChannel(channel.id, {
                    automation: {
                      ...channelData.automation,
                      isRunning: false,
                      runId: null,
                    },
                  });
                  console.log(
                    `[Automation] ✅ Reset stuck isRunning flag for channel ${channel.id} (${minutesSinceLastRun.toFixed(1)} minutes since last run)`
                  );
                } catch (resetError) {
                  console.error(
                    `[Automation] ⚠️ Failed to reset stuck isRunning flag for channel ${channel.id}:`,
                    resetError
                  );
                }
              }
            } else {
              // Если lastRunAt отсутствует, но isRunning=true, сбрасываем флаг
              try {
                await updateChannel(channel.id, {
                  automation: {
                    ...channelData?.automation || channel.automation!,
                    isRunning: false,
                    runId: null,
                  },
                });
                console.log(
                  `[Automation] ✅ Reset isRunning flag for channel ${channel.id} (no lastRunAt)`
                );
              } catch (resetError) {
                console.error(
                  `[Automation] ⚠️ Failed to reset isRunning flag for channel ${channel.id}:`,
                  resetError
                );
              }
            }
          }
        }
      } catch (error: any) {
        console.error(
          `[Automation] Error processing channel ${channel.id}:`,
          error
        );
        
        // Счётчик уже увеличен выше, не увеличиваем повторно
        
        await logger.logEvent({
          level: "error",
          step: "channel-check",
          channelId: channel.id,
          channelName: channel.name,
          message: `Ошибка обработки канала: ${error.message}`,
          details: { error: error.message },
        });
        
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          jobId: null,
          error: error.message,
          timezone: channel.automation?.timeZone || DEFAULT_TIMEZONE,
        });
      }
    }

    const jobsCreated = results.filter((r) => r.jobId).length;
    const duration = Date.now() - startTime;
    
    // Завершаем логирование
    await logger.finishRun();
    
    // Обновляем последнее сообщение об ошибке, если есть
    const errors = results.filter((r) => r.error);
    if (errors.length > 0 && logger) {
      await logger.updateRun({
        lastErrorMessage: errors[0].error || "Неизвестная ошибка",
      });
    }
    
    // Логируем финальную статистику
    console.log("=".repeat(80));
    console.log(`[Automation] ===== SCHEDULED AUTOMATION CHECK COMPLETED =====`);
    console.log(`[Automation] Channels planned: ${enabledChannels.length}`);
    console.log(`[Automation] Channels processed: ${logger.getChannelsProcessed()}`);
    console.log(`[Automation] Jobs created: ${logger.getJobsCreated()}`);
    console.log(`[Automation] Errors: ${logger.getErrorsCount()}`);
    console.log(`[Automation] Duration: ${duration}ms`);
    console.log(`[Automation] Run ID: ${logger.getRunId()}`);
    console.log("=".repeat(80));

    res.json({
      success: true,
      timestamp: currentTimeUTC.toISOString(),
      timezone: DEFAULT_TIMEZONE,
      timezoneTime: timeString,
      processed: results.length,
      jobsCreated,
      duration: `${duration}ms`,
      runId: logger.getRunId(),
      results,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error("=".repeat(80));
    console.error("[Automation] ===== SCHEDULED AUTOMATION CHECK FAILED =====");
    console.error(`[Automation] Error: ${error.message}`);
    console.error(`[Automation] Stack: ${error.stack}`);
    console.error(`[Automation] Duration: ${duration}ms`);
    console.error("=".repeat(80));
    
    // Завершаем логирование с ошибкой
    if (logger) {
      try {
        await logger.logEvent({
          level: "error",
          step: "other",
          message: `Критическая ошибка запуска: ${error.message}`,
          details: { error: error.message, stack: error.stack?.substring(0, 500) },
        });
        await logger.updateRun({
          status: "error",
          lastErrorMessage: error.message,
        });
        await logger.finishRun();
      } catch (logError) {
        console.error("[Automation] Failed to log error:", logError);
      }
    }
    
    res.status(500).json({
      error: "Ошибка при запуске автоматизации",
      message: error.message,
      duration: `${duration}ms`,
      runId: logger?.getRunId(),
    });
  }
});

/**
 * POST /api/automation/reset-running-flags
 * Ручной сброс флагов isRunning для всех каналов (для разблокировки зависших каналов)
 */
router.post("/reset-running-flags", async (req: Request, res: Response) => {
  try {
    const channels = await getAllChannels();
    const enabledChannels = channels.filter(
      (ch) => ch.automation?.enabled === true && ch.automation?.isRunning === true
    );
    
    console.log(`[Automation] Resetting isRunning flags for ${enabledChannels.length} channels`);
    
    const results: Array<{ channelId: string; channelName: string; success: boolean; error?: string }> = [];
    
    for (const channel of enabledChannels) {
      try {
        const { updateChannel } = await import("../models/channel");
        await updateChannel(channel.id, {
          automation: {
            ...channel.automation!,
            isRunning: false,
            runId: null,
          },
        });
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          success: true,
        });
        console.log(`[Automation] ✅ Reset isRunning flag for channel ${channel.id} (${channel.name})`);
      } catch (error: any) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          success: false,
          error: error.message,
        });
        console.error(
          `[Automation] ⚠️ Failed to reset isRunning flag for channel ${channel.id}:`,
          error
        );
      }
    }
    
    res.json({
      success: true,
      message: `Сброшено флагов isRunning: ${results.filter(r => r.success).length} из ${results.length}`,
      results,
    });
  } catch (error: any) {
    console.error("[Automation] Error resetting running flags:", error);
    res.status(500).json({
      error: "Ошибка при сбросе флагов",
      message: error.message,
    });
  }
});

/**
 * POST /api/automation/stop-channel
 * Ручная остановка автоматизации для конкретного канала
 */
router.post("/stop-channel", async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId || typeof channelId !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Требуется channelId",
      });
    }
    
    console.log(`[Automation] Manual stop requested for channel ${channelId}`);
    
    // Проверяем, что канал существует
    const channel = await getChannelById(channelId);
    if (!channel) {
      return res.status(404).json({
        ok: false,
        error: "Канал не найден",
      });
    }
    
    // Обновляем документ канала
    const { updateChannel } = await import("../models/channel");
    await updateChannel(channelId, {
      automation: {
        ...channel.automation!,
        enabled: false,
        isRunning: false,
        runId: null,
        manualStoppedAt: Date.now(),
      },
    });
    
    console.log(`[Automation] ✅ Channel ${channelId} automation disabled`);
    
    // Находим все незавершённые авто-задачи для этого канала
    const { getAllJobs, updateJob } = await import("../models/videoJob");
    const allJobs = await getAllJobs(channelId);
    
    const activeStatuses: import("../models/videoJob").VideoJobStatus[] = [
      "queued",
      "sending",
      "waiting_video",
      "downloading",
      "uploading",
    ];
    
    const unfinishedAutoJobs = allJobs.filter(
      (job) => job.isAuto === true && activeStatuses.includes(job.status)
    );
    
    console.log(
      `[Automation] Found ${unfinishedAutoJobs.length} unfinished auto jobs for channel ${channelId}`
    );
    
    // Отменяем все незавершённые задачи
    let cancelledCount = 0;
    for (const job of unfinishedAutoJobs) {
      try {
        await updateJob(job.id, {
          status: "cancelled",
          errorMessage: "Отменено вручную (остановка автоматизации)",
          updatedAt: Date.now(),
        });
        cancelledCount++;
        console.log(`[Automation] ✅ Cancelled job ${job.id} for channel ${channelId}`);
      } catch (error: any) {
        console.error(
          `[Automation] ⚠️ Failed to cancel job ${job.id}:`,
          error.message
        );
      }
    }
    
    // Логируем событие остановки (если есть система логирования)
    try {
      const { createAutomationEvent } = await import("../firebase/automationRunsService");
      await createAutomationEvent({
        runId: "manual-stop",
        level: "info",
        step: "other",
        channelId: channelId,
        channelName: channel.name,
        message: "Автоматизация остановлена вручную",
        details: {
          cancelledTasks: cancelledCount,
          stoppedAt: Date.now(),
        },
      });
    } catch (logError) {
      console.warn("[Automation] Failed to log manual stop event:", logError);
    }
    
    res.json({
      ok: true,
      cancelledTasks: cancelledCount,
      channelId: channelId,
      message: `Автоматизация остановлена. Отменено задач: ${cancelledCount}`,
    });
  } catch (error: any) {
    console.error("[Automation] Error stopping channel automation:", error);
    res.status(500).json({
      ok: false,
      error: "Ошибка при остановке автоматизации",
      message: error.message,
    });
  }
});

export default router;

