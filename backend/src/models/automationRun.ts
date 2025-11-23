import * as admin from "firebase-admin";

export type AutomationRunStatus = "success" | "partial" | "error";

export type AutomationEventLevel = "info" | "warn" | "error";

export type AutomationEventStep =
  | "select-channels"
  | "channel-check"
  | "generate-idea"
  | "generate-prompt"
  | "create-job"
  | "send-to-bot"
  | "update-channel-next-run"
  | "other";

export type ChannelCheckReason =
  | "time_not_matched"
  | "day_not_allowed"
  | "task_already_exists"
  | "frequency_limit"
  | "disabled"
  | "already_running"
  | "ok";

export interface ChannelCheckDetails {
  channelId: string;
  channelName: string;
  auto: boolean;
  shouldRunNow: boolean;
  reason: ChannelCheckReason;
  details: {
    now: number; // timestamp
    targetTime?: string; // "HH:mm"
    timeMatched?: boolean;
    dayMatched?: boolean;
    lastRunAt?: number | null;
    minutesSinceLastRun?: number;
    frequencyLimit?: boolean;
    activeJobsCount?: number;
    maxActiveTasks?: number;
    timezone: string;
    scheduledTimes?: string[];
    daysOfWeek?: string[];
  };
}

export interface AutomationTask {
  taskId: string;
  channelId: string;
  channelName: string;
  status: "pending" | "queued" | "error" | "done";
  error?: string | null;
  createdAt: admin.firestore.Timestamp;
}

export interface AutomationRun {
  id: string;
  startedAt: admin.firestore.Timestamp;
  finishedAt?: admin.firestore.Timestamp;
  status: AutomationRunStatus;
  schedulerInvocationAt?: admin.firestore.Timestamp;
  channelsPlanned: number;
  channelsProcessed: number;
  jobsCreated: number;
  errorsCount: number;
  lastErrorMessage?: string;
  timezone: string;
  channels?: ChannelCheckDetails[]; // Детальная информация о проверке каналов
  tasks?: AutomationTask[]; // Созданные задачи
}

export interface AutomationEvent {
  runId: string;
  createdAt: admin.firestore.Timestamp;
  level: AutomationEventLevel;
  step: AutomationEventStep;
  channelId?: string;
  channelName?: string;
  message: string;
  details?: Record<string, any>;
}

