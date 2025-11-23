import React, { useState, useEffect } from 'react'
import { apiFetchJson } from '../lib/apiClient'
import { useToast } from '../hooks/useToast'
import '../App.css'

interface ChannelCheckDetails {
  channelId: string
  channelName: string
  auto: boolean
  shouldRunNow: boolean
  reason: 'time_not_matched' | 'day_not_allowed' | 'task_already_exists' | 'frequency_limit' | 'disabled' | 'already_running' | 'ok'
  details: {
    now: number
    targetTime?: string
    timeMatched?: boolean
    dayMatched?: boolean
    lastRunAt?: number | null
    minutesSinceLastRun?: number
    frequencyLimit?: boolean
    activeJobsCount?: number
    maxActiveTasks?: number
    timezone: string
    scheduledTimes?: string[]
    daysOfWeek?: string[]
    error?: string
  }
}

interface AutomationTask {
  taskId: string
  channelId: string
  channelName: string
  status: 'pending' | 'queued' | 'error' | 'done'
  error?: string | null
  createdAt: string
}

interface AutomationRun {
  id: string
  startedAt: string
  finishedAt: string | null
  status: 'success' | 'partial' | 'error'
  schedulerInvocationAt: string | null
  channelsPlanned: number
  channelsProcessed: number
  jobsCreated: number
  errorsCount: number
  lastErrorMessage: string | null
  timezone: string
  channels?: ChannelCheckDetails[]
  tasks?: AutomationTask[]
}

interface AutomationEvent {
  runId: string
  createdAt: string
  level: 'info' | 'warn' | 'error'
  step: string
  channelId: string | null
  channelName: string | null
  message: string
  details: Record<string, any> | null
}

interface SystemInfo {
  timezone: string
  timezoneDisplay: string
  automationEnabled: boolean
  enabledChannelsCount: number
  lastSuccessfulRunTime: string | null
  schedulerJobId: string
  schedulerSchedule: string
  schedulerTimezone: string
}

interface RunDetails {
  runId: string
  startedAt: string
  finishedAt: string | null
  status: 'success' | 'partial' | 'error'
  channelsPlanned: number
  channelsProcessed: number
  jobsCreated: number
  errorsCount: number
  lastErrorMessage: string | null
  timezone: string
  channels: ChannelCheckDetails[]
  tasks: AutomationTask[]
  events: AutomationEvent[]
}

const AutomationDebug: React.FC = () => {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null)
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const toast = useToast()

  const loadRuns = async () => {
    try {
      const data = await apiFetchJson<AutomationRun[]>('/api/automation/debug/runs?limit=20')
      setRuns(data)
    } catch (error: any) {
      console.error('Error loading runs:', error)
      toast.error('Ошибка загрузки запусков: ' + (error.message || 'Неизвестная ошибка'))
    } finally {
      setLoading(false)
    }
  }

  const loadSystemInfo = async () => {
    try {
      const data = await apiFetchJson<SystemInfo>('/api/automation/debug/system')
      setSystemInfo(data)
    } catch (error: any) {
      console.error('Error loading system info:', error)
    }
  }

  const loadRunDetails = async (runId: string) => {
    setLoadingDetails(true)
    try {
      const data = await apiFetchJson<RunDetails>(`/api/automation/debug/run-details?runId=${runId}`)
      setRunDetails(data)
      setSelectedRunId(runId)
    } catch (error: any) {
      console.error('Error loading run details:', error)
      toast.error('Ошибка загрузки деталей запуска: ' + (error.message || 'Неизвестная ошибка'))
    } finally {
      setLoadingDetails(false)
    }
  }

  useEffect(() => {
    loadRuns()
    loadSystemInfo()
    // Обновляем каждые 30 секунд
    const interval = setInterval(() => {
      loadRuns()
      loadSystemInfo()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${day}.${month}, ${hours}:${minutes}`
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  const getStatusBadge = (status: AutomationRun['status']) => {
    const colors = {
      success: '#10b981',
      partial: '#f59e0b',
      error: '#ef4444',
    }
    const labels = {
      success: 'Успешно',
      partial: 'Частично',
      error: 'Ошибка',
    }
    return (
      <span
        style={{
          backgroundColor: colors[status],
          color: 'white',
          padding: '0.25rem 0.75rem',
          borderRadius: '12px',
          fontSize: '0.875rem',
          fontWeight: '500',
        }}
      >
        {labels[status]}
      </span>
    )
  }

  const getSystemStatus = () => {
    if (!systemInfo || !runs.length) {
      return { status: 'unknown', label: 'Неизвестно', color: '#6b7280' }
    }

    const lastRun = runs[0]
    const lastRunTime = new Date(lastRun.startedAt)
    const minutesAgo = (Date.now() - lastRunTime.getTime()) / 1000 / 60

    if (lastRun.status === 'success' && minutesAgo <= 10) {
      return { status: 'ok', label: 'Автоматизация работает нормально', color: '#10b981' }
    } else if (lastRun.status === 'partial') {
      return { status: 'partial', label: 'Есть частичные ошибки', color: '#f59e0b' }
    } else {
      return { status: 'error', label: 'Автоматизация не работает', color: '#ef4444' }
    }
  }

  const getDuration = (run: AutomationRun) => {
    if (!run.finishedAt) return 'В процессе...'
    const start = new Date(run.startedAt).getTime()
    const end = new Date(run.finishedAt).getTime()
    const seconds = Math.round((end - start) / 1000)
    return `${seconds} сек`
  }

  const getStepLabel = (step: string) => {
    const labels: Record<string, string> = {
      'select-channels': 'Выбор каналов',
      'channel-check': 'Проверка канала',
      'generate-idea': 'Генерация идеи',
      'generate-prompt': 'Генерация промпта',
      'create-job': 'Создание задачи',
      'send-to-bot': 'Отправка в бота',
      'update-channel-next-run': 'Обновление расписания',
      'other': 'Прочее',
    }
    return labels[step] || step
  }

  const systemStatus = getSystemStatus()

  // Получаем список уникальных каналов из событий для фильтра
  const availableChannels = runDetails
    ? Array.from(
        new Set(
          runDetails.events
            .map((e) => e.channelName)
            .filter((name): name is string => name !== null)
        )
      )
    : []

  const filteredEvents = runDetails
    ? selectedChannelFilter
      ? runDetails.events.filter((e) => e.channelName === selectedChannelFilter)
      : runDetails.events
    : []

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div className="card">
        <h2>Диагностика автоматизации</h2>

        {/* Блок 1: Состояние системы */}
        <div
          style={{
            backgroundColor: '#f9fafb',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem',
            border: `2px solid ${systemStatus.color}`,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Состояние системы</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                Статус
              </div>
              <div
                style={{
                  backgroundColor: systemStatus.color,
                  color: 'white',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontWeight: '500',
                  display: 'inline-block',
                }}
              >
                {systemStatus.label}
              </div>
            </div>
            {systemInfo && (
              <>
                <div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                    Часовой пояс
                  </div>
                  <div style={{ fontWeight: '500' }}>{systemInfo.timezoneDisplay}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                    Последний запуск
                  </div>
                  <div style={{ fontWeight: '500' }}>
                    {runs.length > 0 ? formatDateTime(runs[0].startedAt) : 'Нет данных'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                    Следующий запуск
                  </div>
                  <div style={{ fontWeight: '500' }}>
                    Cloud Scheduler каждые 5 минут
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '1rem' }}>
            Если запуски не появляются дольше 10 минут — проверьте Cloud Scheduler и логи сервиса
            whitecoding-backend
          </div>
        </div>

        {/* Блок 2: Список запусков */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Список запусков</h3>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>Загрузка...</div>
          ) : runs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
              Запуски не найдены
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Запуск</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Статус</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Каналы</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Задачи</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Ошибки</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Длительность</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const skippedChannels = run.channelsPlanned - (run.channels?.filter(c => c.shouldRunNow).length || run.jobsCreated)
                    const channelsDisplay = run.channelsPlanned > 0 
                      ? `${run.channelsProcessed} (${run.jobsCreated} задач, ${skippedChannels} пропущено)`
                      : run.channelsProcessed
                    
                    return (
                      <tr
                        key={run.id}
                        style={{
                          borderBottom: '1px solid #e5e7eb',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f9fafb'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }}
                      >
                        <td style={{ padding: '0.75rem' }}>{formatDateTime(run.startedAt)}</td>
                        <td style={{ padding: '0.75rem' }}>{getStatusBadge(run.status)}</td>
                        <td style={{ padding: '0.75rem' }}>{channelsDisplay}</td>
                        <td style={{ padding: '0.75rem' }}>{run.jobsCreated}</td>
                        <td style={{ padding: '0.75rem' }}>{run.errorsCount}</td>
                        <td style={{ padding: '0.75rem' }}>{getDuration(run)}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              loadRunDetails(run.id)
                            }}
                            style={{
                              background: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              padding: '0.375rem 0.75rem',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.875rem',
                            }}
                          >
                            Подробнее
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Модальное окно с деталями запуска */}
        {selectedRunId && runDetails && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '1rem',
            }}
            onClick={() => {
              setSelectedRunId(null)
              setRunDetails(null)
              setSelectedChannelFilter(null)
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: '1200px',
                maxHeight: '90vh',
                overflow: 'auto',
                width: '100%',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Детали запуска</h3>
                <button
                  onClick={() => {
                    setSelectedRunId(null)
                    setRunDetails(null)
                    setSelectedChannelFilter(null)
                  }}
                  style={{
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Закрыть
                </button>
              </div>

              {loadingDetails ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>Загрузка деталей...</div>
              ) : (
                <>
                  {/* Резюме запуска */}
                  <div
                    style={{
                      backgroundColor: '#f9fafb',
                      padding: '1rem',
                      borderRadius: '8px',
                      marginBottom: '1.5rem',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Run ID</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{runDetails.runId}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Статус</div>
                        <div>{getStatusBadge(runDetails.status)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Начало</div>
                        <div>{formatDateTime(runDetails.startedAt)}</div>
                      </div>
                      {runDetails.finishedAt && (
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Окончание</div>
                          <div>{formatDateTime(runDetails.finishedAt)}</div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Каналов обработано</div>
                        <div>{runDetails.channelsProcessed} / {runDetails.channelsPlanned}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Задач создано</div>
                        <div>{runDetails.jobsCreated}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Ошибок</div>
                        <div>{runDetails.errorsCount}</div>
                      </div>
                      {runDetails.lastErrorMessage && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Последняя ошибка</div>
                          <div style={{ color: '#ef4444' }}>{runDetails.lastErrorMessage}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Секция: Каналы */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '1rem' }}>Каналы</h4>
                    {runDetails.channels.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                        Информация о каналах не найдена
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Канал</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Причина пропуска</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Время</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Последний запуск</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Дни недели</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runDetails.channels.map((channel, idx) => {
                              const getReasonLabel = (reason: string) => {
                                const labels: Record<string, string> = {
                                  'time_not_matched': 'Время не совпало',
                                  'day_not_allowed': 'День недели не разрешён',
                                  'task_already_exists': 'Задача уже существует',
                                  'frequency_limit': 'Достигнут лимит частоты',
                                  'disabled': 'Автоматизация отключена',
                                  'already_running': 'Уже выполняется',
                                  'ok': 'Задача создана',
                                }
                                return labels[reason] || reason
                              }
                              
                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                  <td style={{ padding: '0.75rem' }}>{channel.channelName}</td>
                                  <td style={{ padding: '0.75rem' }}>
                                    <span
                                      style={{
                                        backgroundColor: channel.shouldRunNow ? '#10b981' : '#ef4444',
                                        color: 'white',
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                      }}
                                    >
                                      {getReasonLabel(channel.reason)}
                                    </span>
                                  </td>
                                  <td style={{ padding: '0.75rem' }}>
                                    {channel.details.targetTime || '—'}
                                    {channel.details.timeMatched !== undefined && (
                                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: channel.details.timeMatched ? '#10b981' : '#ef4444' }}>
                                        {channel.details.timeMatched ? '✓' : '✗'}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '0.75rem' }}>
                                    {channel.details.lastRunAt
                                      ? `${Math.round(channel.details.minutesSinceLastRun || 0)} мин назад`
                                      : 'Никогда'}
                                  </td>
                                  <td style={{ padding: '0.75rem' }}>
                                    {channel.details.daysOfWeek?.join(', ') || '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Секция: Созданные задачи */}
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '1rem' }}>Созданные задачи</h4>
                    {runDetails.tasks.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                        Задачи не созданы
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>ID задачи</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Канал</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Статус</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Ошибка</th>
                              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Время создания</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runDetails.tasks.map((task, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                  {task.taskId}
                                </td>
                                <td style={{ padding: '0.75rem' }}>{task.channelName}</td>
                                <td style={{ padding: '0.75rem' }}>
                                  <span
                                    style={{
                                      backgroundColor:
                                        task.status === 'done'
                                          ? '#10b981'
                                          : task.status === 'error'
                                          ? '#ef4444'
                                          : task.status === 'queued'
                                          ? '#3b82f6'
                                          : '#f59e0b',
                                      color: 'white',
                                      padding: '0.25rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                    }}
                                  >
                                    {task.status}
                                  </span>
                                </td>
                                <td style={{ padding: '0.75rem', color: task.error ? '#ef4444' : '#6b7280' }}>
                                  {task.error || '—'}
                                </td>
                                <td style={{ padding: '0.75rem' }}>{formatDateTime(task.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Секция: События */}
                  <div>
                    <h4 style={{ marginBottom: '1rem' }}>События</h4>
                    {runDetails.events.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                        События не найдены
                      </div>
                    ) : (
                      <>
                        {/* Фильтр по каналу */}
                        {availableChannels.length > 0 && (
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ marginRight: '0.5rem', fontSize: '0.875rem' }}>Фильтр по каналу:</label>
                            <select
                              value={selectedChannelFilter || ''}
                              onChange={(e) => setSelectedChannelFilter(e.target.value || null)}
                              style={{
                                padding: '0.5rem',
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                fontSize: '0.875rem',
                              }}
                            >
                              <option value="">Все каналы</option>
                              {availableChannels.map((channel) => (
                                <option key={channel} value={channel}>
                                  {channel}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                          {filteredEvents.map((event, index) => (
                            <div
                              key={index}
                              style={{
                                padding: '0.75rem',
                                borderRadius: '6px',
                                backgroundColor:
                                  event.level === 'error'
                                    ? '#fee2e2'
                                    : event.level === 'warn'
                                    ? '#fef3c7'
                                    : '#f0f9ff',
                                borderLeft: `4px solid ${
                                  event.level === 'error'
                                    ? '#ef4444'
                                    : event.level === 'warn'
                                    ? '#f59e0b'
                                    : '#3b82f6'
                                }`,
                              }}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280' }}>
                                  {formatTime(event.createdAt)}
                                </span>
                                {event.channelName && (
                                  <span
                                    style={{
                                      backgroundColor: '#e5e7eb',
                                      padding: '0.125rem 0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                    }}
                                  >
                                    {event.channelName}
                                  </span>
                                )}
                                <span
                                  style={{
                                    backgroundColor: '#dbeafe',
                                    padding: '0.125rem 0.5rem',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                  }}
                                >
                                  {getStepLabel(event.step)}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.875rem' }}>{event.message}</div>
                              {event.details && Object.keys(event.details).length > 0 && (
                                <details style={{ marginTop: '0.5rem' }}>
                                  <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#6b7280' }}>
                                    Детали
                                  </summary>
                                  <pre
                                    style={{
                                      marginTop: '0.5rem',
                                      padding: '0.5rem',
                                      backgroundColor: 'white',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      overflow: 'auto',
                                    }}
                                  >
                                    {JSON.stringify(event.details, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AutomationDebug

