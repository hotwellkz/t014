import React, { useState, useEffect } from 'react'
import '../App.css'
import { apiFetch, apiFetchJson, ApiError } from '../lib/apiClient'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from './Toast'

type Language = 'ru' | 'kk' | 'en'

interface ChannelAutomation {
  enabled: boolean
  frequencyPerDay: number
  times: string[]
  daysOfWeek: string[]
  autoApproveAndUpload: boolean
  useOnlyFreshIdeas: boolean
  maxActiveTasks: number
  lastRunAt?: number | null
  timeZone?: string
  nextRunAt?: number | null
  isRunning?: boolean
  runId?: string | null
  manualStoppedAt?: number | null
  status?: 'idle' | 'running' | 'success' | 'error'
  statusMessage?: string | null
  lastStatusAt?: number | null
  currentStep?: string | null
}

interface Channel {
  id: string
  name: string
  description: string
  language: Language
  durationSeconds: number
  ideaPromptTemplate: string
  videoPromptTemplate: string
  gdriveFolderId?: string | null
  externalUrl?: string | undefined
  automation?: ChannelAutomation
}

const ChannelSettings: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const toast = useToast()
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    language: 'ru' as Language,
    durationSeconds: 8,
    ideaPromptTemplate: '',
    videoPromptTemplate: '',
    gdriveFolderId: '',
    externalUrl: '',
    automation: {
      enabled: false,
      frequencyPerDay: 0,
      times: [''],
      daysOfWeek: [] as string[],
      autoApproveAndUpload: false,
      useOnlyFreshIdeas: false,
      maxActiveTasks: 2,
      manualStoppedAt: null,
    } as ChannelAutomation,
  })

  useEffect(() => {
    fetchChannels()
    
    // Обновляем статус автоматизации каждые 30 секунд
    const interval = setInterval(() => {
      if (editingId) {
        fetchChannels()
      }
    }, 30000)
    
    return () => clearInterval(interval)
  }, [editingId])

  const getErrorMessage = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.isNetworkError || !err.status || err.status >= 500 || err.status === 404) {
        return 'Не удалось подключиться к серверу. Проверьте настройки backend API.'
      }
      return err.message
    }
    if (err instanceof Error) return err.message
    return 'Неизвестная ошибка'
  }

  const fetchChannels = async () => {
    try {
      const data = await apiFetchJson<Channel[]>('/api/channels')
      setChannels(data)
    } catch (err) {
      console.error('[ChannelSettings] Failed to load channels', err)
      setError(getErrorMessage(err))
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      language: 'ru',
      durationSeconds: 8,
      ideaPromptTemplate: '',
      videoPromptTemplate: '',
      gdriveFolderId: '',
      externalUrl: '',
      automation: {
        enabled: false,
        frequencyPerDay: 0,
        times: [''],
        daysOfWeek: [],
        autoApproveAndUpload: false,
        useOnlyFreshIdeas: false,
        maxActiveTasks: 2,
        timeZone: 'Asia/Almaty',
      },
    })
    setEditingId(null)
  }

  const handleEdit = (channel: Channel) => {
    setFormData({
      name: channel.name,
      description: channel.description,
      language: channel.language,
      durationSeconds: channel.durationSeconds,
      ideaPromptTemplate: channel.ideaPromptTemplate,
      videoPromptTemplate: channel.videoPromptTemplate,
      gdriveFolderId: channel.gdriveFolderId || '',
      externalUrl: channel.externalUrl || '',
      automation: channel.automation ? {
        ...channel.automation,
        timeZone: channel.automation.timeZone || 'Asia/Almaty',
      } : {
        enabled: false,
        frequencyPerDay: 0,
        times: [''],
        daysOfWeek: [],
        autoApproveAndUpload: false,
        useOnlyFreshIdeas: false,
        maxActiveTasks: 2,
        timeZone: 'Asia/Almaty',
      },
    })
    setEditingId(channel.id)
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const url = editingId ? `/api/channels/${editingId}` : '/api/channels'
      const method = editingId ? 'PUT' : 'POST'

      const updatedChannel = await apiFetchJson<Channel>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      // Обновляем formData с актуальными данными из ответа (особенно nextRunAt)
      if (editingId && updatedChannel.automation) {
        setFormData({
          ...formData,
          automation: {
            ...formData.automation,
            ...updatedChannel.automation,
          },
        })
      }

      resetForm()
      setSuccess(editingId ? 'Канал успешно обновлён!' : 'Канал успешно создан!')
      fetchChannels()
    } catch (err) {
      console.error('[ChannelSettings] Failed to save channel', err)
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот канал?')) return

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await apiFetch(`/api/channels/${id}`, {
        method: 'DELETE',
      })
      setSuccess('Канал успешно удалён!')
      fetchChannels()
    } catch (err) {
      console.error('[ChannelSettings] Failed to delete channel', err)
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <div className="channel-settings-container">
        <div className="card">
        <h2>{editingId ? 'Редактировать канал' : 'Добавить канал'}</h2>
        {error && (
          <div className="error channel-settings-alert" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="success channel-settings-alert" role="alert">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Название канала</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="Например: Бабушка и Дедушка Life"
              required
            />
          </div>

          <div className="input-group">
            <label>Описание стиля</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Краткое описание стиля канала"
            />
          </div>

          <div className="input-group">
            <label>Основной язык</label>
            <select
              value={formData.language}
              onChange={(e) =>
                setFormData({ ...formData, language: e.target.value as Language })
              }
            >
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="input-group">
            <label>Длительность (сек)</label>
            <input
              type="number"
              min="1"
              max="60"
              value={formData.durationSeconds}
              onChange={(e) =>
                setFormData({ ...formData, durationSeconds: parseInt(e.target.value) || 8 })
              }
              required
            />
          </div>

          <div className="input-group">
            <label>Промпт для генерации идей</label>
            <textarea
              value={formData.ideaPromptTemplate}
              onChange={(e) =>
                setFormData({ ...formData, ideaPromptTemplate: e.target.value })
              }
              placeholder="Сгенерируй 5 идей для очень смешных 8-секундных видео..."
              rows={6}
              required
            />
            <small style={{ color: '#718096', marginTop: '0.5rem', display: 'block' }}>
              Этот промпт будет использоваться для генерации идей через OpenAI. 
              Можете использовать плейсхолдеры: {'{{DURATION}}'}, {'{{LANGUAGE}}'}, {'{{DESCRIPTION}}'}
            </small>
          </div>

          <div className="input-group">
            <label>Промпт для генерации Veo-промпта + названия</label>
            <textarea
              value={formData.videoPromptTemplate}
              onChange={(e) =>
                setFormData({ ...formData, videoPromptTemplate: e.target.value })
              }
              placeholder='На основе следующей идеи сгенерируй детализированный промпт для Veo 3.1 Fast...'
              rows={8}
              required
            />
            <small style={{ color: '#718096', marginTop: '0.5rem', display: 'block' }}>
              Используйте {'{{IDEA_TEXT}}'} для подстановки выбранной идеи. 
              OpenAI должен вернуть JSON с полями veo_prompt и video_title.
            </small>
          </div>

          <div className="input-group">
            <label>ID папки Google Drive (необязательно)</label>
            <input
              type="text"
              value={formData.gdriveFolderId}
              onChange={(e) =>
                setFormData({ ...formData, gdriveFolderId: e.target.value })
              }
              placeholder="Например, 1AbCdEfGh..."
            />
            <small style={{ color: '#718096', marginTop: '0.5rem', display: 'block' }}>
              Видео для этого канала будут сохраняться в эту папку. Если пусто — используется папка по умолчанию из настроек сервера.
            </small>
          </div>

          <div className="input-group">
            <label>Ссылка на канал (опционально)</label>
            <input
              type="text"
              value={formData.externalUrl}
              onChange={(e) => {
                const value = e.target.value
                // Валидация на клиенте (опционально)
                if (value && value.trim() && !value.startsWith('http://') && !value.startsWith('https://')) {
                  setError('Ссылка должна начинаться с http:// или https://')
                } else {
                  setError('')
                }
                setFormData({ ...formData, externalUrl: value })
              }}
              placeholder="https://www.youtube.com/@example"
            />
            <small style={{ color: '#718096', marginTop: '0.5rem', display: 'block' }}>
              Ссылка на YouTube-канал. Можно оставить пустым.
            </small>
          </div>

          {/* Блок автоматизации */}
          <div className={`automation-block ${formData.automation.enabled ? 'automation-block--enabled' : 'automation-block--disabled'}`}>
            <div className="automation-block__header">
              <h3 className="automation-block__title">
                <span className="automation-block__icon">🔄</span>
                Автоматизация роликов
              </h3>
              <div className="automation-toggle">
                <button
                  type="button"
                  className={`automation-toggle__button ${formData.automation.enabled ? 'automation-toggle__button--on' : 'automation-toggle__button--off'}`}
                  onClick={() => {
                    setFormData({
                      ...formData,
                      automation: { ...formData.automation, enabled: !formData.automation.enabled }
                    })
                  }}
                  aria-label={formData.automation.enabled ? 'Выключить автоматизацию' : 'Включить автоматизацию'}
                >
                  <span className="automation-toggle__slider">
                    <span className="automation-toggle__label automation-toggle__label--on">ON</span>
                    <span className="automation-toggle__label automation-toggle__label--off">OFF</span>
                  </span>
                </button>
              </div>
            </div>

            <p className="automation-block__hint">
              Когда автоматизация включена — система автоматически создаёт идеи, промпты и генерирует видео по расписанию.
            </p>

            {/* Статус автоматизации */}
            {formData.automation.enabled && (
              <div className="automation-status">
                {formData.automation.isRunning || formData.automation.status === 'running' ? (
                  <div className="automation-status__running" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="automation-status__indicator automation-status__indicator--running"></span>
                        <span className="automation-status__text">
                          {formData.automation.currentStep 
                            ? `Автоматизация: ${formData.automation.currentStep}`
                            : formData.automation.statusMessage || 'Автоматизация выполняется...'}
                        </span>
                      </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!editingId) return;
                        
                        const confirmed = window.confirm(
                          'Остановить автоматизацию для этого канала?\n\nВсе незавершённые задачи будут отменены.'
                        );
                        
                        if (!confirmed) return;
                        
                        setLoading(true);
                        setError('');
                        
                        try {
                          const result = await apiFetchJson<{ ok: boolean; cancelledTasks: number; message?: string; error?: string }>(
                            '/api/automation/stop-channel',
                            {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ channelId: editingId }),
                            }
                          );
                          
                          if (result.ok) {
                            setSuccess(result.message || `Автоматизация остановлена. Отменено задач: ${result.cancelledTasks}`);
                            
                            // Обновляем состояние канала
                            setFormData({
                              ...formData,
                              automation: {
                                ...formData.automation,
                                enabled: false,
                                isRunning: false,
                              },
                            });
                            
                            // Обновляем данные канала с сервера
                            setTimeout(() => {
                              fetchChannels();
                              if (editingId) {
                                const channel = channels.find(c => c.id === editingId);
                                if (channel) {
                                  setFormData({
                                    ...formData,
                                    automation: channel.automation || formData.automation,
                                  });
                                }
                              }
                            }, 500);
                            
                            // Показываем toast (если есть система toast)
                            if (toast) {
                              toast.success(`Автоматизация для канала остановлена. Отменено задач: ${result.cancelledTasks}`);
                            }
                          } else {
                            throw new Error(result.error || 'Не удалось остановить автоматизацию');
                          }
                        } catch (err) {
                          const errorMsg = getErrorMessage(err);
                          setError(errorMsg);
                          console.error('[ChannelSettings] Error stopping automation:', err);
                          
                          // Показываем toast с ошибкой
                          if (toast) {
                            toast.error('Не удалось остановить автоматизацию. Попробуйте позже.');
                          }
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'transparent',
                        color: '#ef4444',
                        border: '1px solid #ef4444',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        opacity: loading ? 0.6 : 1,
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!loading) {
                          e.currentTarget.style.backgroundColor = '#fee2e2';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!loading) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      {loading ? (
                        <>
                          <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #ef4444', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></span>
                          Остановка...
                        </>
                      ) : (
                        <>
                          <span>⏹</span>
                          Остановить автоматизацию
                        </>
                      )}
                    </button>
                    </div>
                  </div>
                ) : formData.automation.status === 'success' ? (
                  <div className="automation-status__idle" style={{ backgroundColor: '#d1fae5', border: '1px solid #10b981', borderRadius: '4px', padding: '8px 12px' }}>
                    <span className="automation-status__indicator" style={{ backgroundColor: '#10b981' }}></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="automation-status__text" style={{ fontWeight: '500' }}>✅ Успешно</span>
                      {formData.automation.statusMessage && (
                        <span className="automation-status__text" style={{ fontSize: '0.875rem', color: '#065f46' }}>
                          {formData.automation.statusMessage}
                        </span>
                      )}
                      {formData.automation.lastStatusAt && (
                        <span className="automation-status__text" style={{ fontSize: '0.75rem', color: '#047857' }}>
                          {new Date(formData.automation.lastStatusAt).toLocaleString('ru-RU')}
                        </span>
                      )}
                    </div>
                  </div>
                ) : formData.automation.status === 'error' ? (
                  <div className="automation-status__idle" style={{ backgroundColor: '#fee2e2', border: '1px solid #ef4444', borderRadius: '4px', padding: '8px 12px' }}>
                    <span className="automation-status__indicator" style={{ backgroundColor: '#ef4444' }}></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="automation-status__text" style={{ fontWeight: '500', color: '#991b1b' }}>❌ Ошибка</span>
                      {formData.automation.statusMessage && (
                        <span className="automation-status__text" style={{ fontSize: '0.875rem', color: '#991b1b' }}>
                          {formData.automation.statusMessage}
                        </span>
                      )}
                      {formData.automation.lastStatusAt && (
                        <span className="automation-status__text" style={{ fontSize: '0.75rem', color: '#7f1d1d' }}>
                          {new Date(formData.automation.lastStatusAt).toLocaleString('ru-RU')}
                        </span>
                      )}
                    </div>
                  </div>
                ) : formData.automation.manualStoppedAt ? (
                  <div className="automation-status__idle" style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '4px', padding: '8px 12px' }}>
                    <span className="automation-status__indicator" style={{ backgroundColor: '#f59e0b' }}></span>
                    <span className="automation-status__text">Автоматизация остановлена вручную</span>
                  </div>
                ) : (
                  <div className="automation-status__idle">
                    <span className="automation-status__indicator automation-status__indicator--idle"></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="automation-status__text">Автоматизация включена. Ожидаем следующего запуска.</span>
                      {formData.automation.nextRunAt && (
                        <span className="automation-status__text" style={{ fontSize: '0.875rem', color: '#718096' }}>
                          Следующий запуск: {new Date(formData.automation.nextRunAt).toLocaleString('ru-RU')}
                        </span>
                      )}
                      {formData.automation.lastRunAt && (
                        <span className="automation-status__text" style={{ fontSize: '0.875rem', color: '#718096' }}>
                          Последний запуск: {new Date(formData.automation.lastRunAt).toLocaleString('ru-RU')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Кнопка ручного запуска */}
                {!formData.automation.isRunning && editingId && (
                  <div style={{ marginTop: '12px' }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!editingId) return;
                        setLoading(true);
                        setError('');
                        try {
                          const result = await apiFetchJson<{ success: boolean; jobId: string; message: string }>(
                            `/api/automation/channels/${editingId}/run-now`,
                            { method: 'POST' }
                          );
                          setSuccess(result.message || 'Автоматизация запущена. Новые задачи появятся в истории генераций.');
                          // Обновляем данные канала
                          setTimeout(() => {
                            fetchChannels();
                            if (editingId) {
                              const channel = channels.find(c => c.id === editingId);
                              if (channel) {
                                setFormData({
                                  ...formData,
                                  automation: channel.automation || formData.automation,
                                });
                              }
                            }
                          }, 1000);
                        } catch (err) {
                          setError(getErrorMessage(err));
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading || formData.automation.isRunning}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: loading || formData.automation.isRunning ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span>▶</span>
                      <span>{loading ? 'Запускаем...' : 'Запустить сейчас'}</span>
                    </button>
                  </div>
                )}
                
                <div className="automation-status__info">
                  <div className="automation-status__item">
                    <strong>Часовой пояс:</strong> {formData.automation.timeZone || 'Asia/Almaty'} (UTC+6)
                  </div>
                  {formData.automation.lastRunAt ? (
                    <div className="automation-status__item">
                      <strong>Последний запуск:</strong>{' '}
                      {new Date(formData.automation.lastRunAt).toLocaleString('ru-RU', {
                        timeZone: formData.automation.timeZone || 'Asia/Almaty',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  ) : (
                    <div className="automation-status__item">
                      <strong>Последний запуск:</strong> ещё не запускалось
                    </div>
                  )}
                  {formData.automation.nextRunAt ? (
                    <div className="automation-status__item">
                      <strong>Следующий запуск:</strong>{' '}
                      {new Date(formData.automation.nextRunAt).toLocaleString('ru-RU', {
                        timeZone: formData.automation.timeZone || 'Asia/Almaty',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  ) : (
                    <div className="automation-status__item">
                      <strong>Следующий запуск:</strong> не запланирован
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className={`automation-block__content ${!formData.automation.enabled ? 'automation-block__content--disabled' : ''}`}>
              <div className="input-group">
                <label className="automation-label">Частота генерации</label>
                <select
                  className="automation-select"
                  value={formData.automation.frequencyPerDay}
                  onChange={(e) => {
                    const freq = parseInt(e.target.value)
                    const times = freq > 0 ? Array(freq).fill('').map((_, i) => i === 0 ? '10:00' : '') : ['']
                    setFormData({
                      ...formData,
                      automation: { ...formData.automation, frequencyPerDay: freq, times }
                    })
                  }}
                  disabled={!formData.automation.enabled}
                >
                  <option value={0}>Нет</option>
                  <option value={1}>1 ролик в день</option>
                  <option value={2}>2 ролика в день</option>
                  <option value={3}>3 ролика в день</option>
                  <option value={4}>4 ролика в день</option>
                  <option value={5}>5 роликов в день</option>
                  <option value={6}>6 роликов в день</option>
                </select>
                <small className="automation-hint">Выберите, сколько роликов создавать в день</small>
              </div>

              {formData.automation.frequencyPerDay > 0 && (
                <div className="input-group">
                  <label className="automation-label">Время генерации (HH:mm)</label>
                  <div className="automation-times">
                    {Array.from({ length: formData.automation.frequencyPerDay }).map((_, index) => (
                      <input
                        key={index}
                        type="time"
                        className="automation-time-input"
                        value={formData.automation.times[index] || ''}
                        onChange={(e) => {
                          const newTimes = [...formData.automation.times]
                          newTimes[index] = e.target.value
                          setFormData({
                            ...formData,
                            automation: { ...formData.automation, times: newTimes }
                          })
                        }}
                        disabled={!formData.automation.enabled}
                      />
                    ))}
                  </div>
                  <small className="automation-hint">
                    Укажите время, когда должна запускаться генерация.
                    <br />
                    <strong>Время указывается по часовому поясу: Астана (Asia/Almaty, UTC+6).</strong>
                  </small>
                </div>
              )}

              <div className="input-group">
                <label className="automation-label">Дни недели</label>
                <div className="automation-days">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => {
                    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                    const dayNumber = String(index + 1)
                    const isChecked = formData.automation.daysOfWeek.includes(dayNames[index]) || 
                                     formData.automation.daysOfWeek.includes(dayNumber)
                    return (
                      <button
                        key={index}
                        type="button"
                        className={`automation-day-chip ${isChecked ? 'automation-day-chip--active' : ''}`}
                        onClick={() => {
                          const newDays = [...formData.automation.daysOfWeek]
                          if (isChecked) {
                            const idx1 = newDays.indexOf(dayNames[index])
                            const idx2 = newDays.indexOf(dayNumber)
                            if (idx1 >= 0) newDays.splice(idx1, 1)
                            if (idx2 >= 0) newDays.splice(idx2, 1)
                          } else {
                            if (!newDays.includes(dayNames[index])) newDays.push(dayNames[index])
                            if (!newDays.includes(dayNumber)) newDays.push(dayNumber)
                          }
                          setFormData({
                            ...formData,
                            automation: { ...formData.automation, daysOfWeek: newDays }
                          })
                        }}
                        disabled={!formData.automation.enabled}
                        aria-pressed={isChecked}
                      >
                        {day}
                      </button>
                    )
                  })}
                </div>
                <small className="automation-hint">В какие дни автоматизация должна запускать создание роликов</small>
              </div>

              <div className="automation-options">
                <h4 className="automation-options__title">Опции автоматизации</h4>
                
                <label className="automation-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.automation.useOnlyFreshIdeas}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        automation: { ...formData.automation, useOnlyFreshIdeas: e.target.checked }
                      })
                    }}
                    disabled={!formData.automation.enabled}
                  />
                  <span className="automation-checkbox__label">
                    Использовать только новые идеи (не повторяться)
                  </span>
                </label>

                <label className="automation-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.automation.autoApproveAndUpload}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        automation: { ...formData.automation, autoApproveAndUpload: e.target.checked }
                      })
                    }}
                    disabled={!formData.automation.enabled}
                  />
                  <span className="automation-checkbox__label">
                    Автоматически одобрять и отправлять в Google Drive / YouTube
                  </span>
                </label>
              </div>

              <div className="input-group">
                <label className="automation-label">Одновременно создаваемых видео</label>
                <input
                  type="number"
                  className="automation-input"
                  min="1"
                  max="10"
                  value={formData.automation.maxActiveTasks}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      automation: { ...formData.automation, maxActiveTasks: parseInt(e.target.value) || 2 }
                    })
                  }}
                  disabled={!formData.automation.enabled}
                />
                <small className="automation-hint">
                  Чтобы сервер не перегружался, можно ограничить количество параллельных генераций
                </small>
              </div>
            </div>

            <div className="automation-description">
              <h4 className="automation-description__title">Как работает автоматизация:</h4>
              <ol className="automation-description__list">
                <li>Генерирует указанное количество идей для канала</li>
                <li>Выбирает 1 идею и генерирует PROMPT для Veo 3.1 Fast</li>
                <li>Создаёт задачу генерации видео</li>
                <li>Дожидается готового результата от Syntex</li>
                <li>Автоматически нажимает «Одобрить» и загружает видео в Google Drive / YouTube</li>
              </ol>
            </div>
          </div>

          <div className="channel-settings-form-actions">
            <button
              type="submit"
              className="button channel-settings-submit-button"
              disabled={loading}
            >
              {loading ? 'Сохранение...' : editingId ? 'Сохранить изменения' : 'Создать канал'}
            </button>
            {editingId && (
              <button
                type="button"
                className="button channel-settings-cancel-button"
                onClick={resetForm}
                disabled={loading}
              >
                Отмена
              </button>
            )}
          </div>
        </form>
        </div>

        <div className="card">
          <h2>Список каналов</h2>
        <div className="channel-list">
          {channels.length === 0 ? (
            <p className="channel-list-empty">Каналы не найдены</p>
          ) : (
            <>
              {/* Десктопная таблица */}
              <div className="channel-list-table-wrapper">
                <table className="channel-list-table">
                  <thead>
                    <tr>
                      <th>Имя</th>
                      <th>Язык</th>
                      <th>Длительность</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((channel) => (
                      <tr key={channel.id}>
                        <td>
                          <strong>{channel.name}</strong>
                          {channel.description && (
                            <div className="channel-description">{channel.description}</div>
                          )}
                        </td>
                        <td>{channel.language.toUpperCase()}</td>
                        <td>{channel.durationSeconds}с</td>
                        <td>
                          <div className="channel-actions-desktop">
                            <button
                              className="button"
                              onClick={() => handleEdit(channel)}
                              disabled={loading}
                            >
                              Редактировать
                            </button>
                            <button
                              className="button button-danger"
                              onClick={() => handleDelete(channel.id)}
                              disabled={loading}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Мобильные карточки */}
              <div className="channel-list-cards">
                {channels.map((channel) => (
                  <div key={channel.id} className="channel-card-mobile">
                    <div className="channel-card-mobile__header">
                      <div className="channel-card-mobile__info">
                        <h3 className="channel-card-mobile__name">{channel.name}</h3>
                        {channel.description && (
                          <p className="channel-card-mobile__description">{channel.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="channel-card-mobile__meta">
                      <span className="channel-card-mobile__meta-item">
                        <strong>Язык:</strong> {channel.language.toUpperCase()}
                      </span>
                      <span className="channel-card-mobile__meta-item">
                        <strong>Длительность:</strong> {channel.durationSeconds}с
                      </span>
                    </div>
                    <div className="channel-card-mobile__actions">
                      <button
                        className="button channel-card-mobile__button"
                        onClick={() => handleEdit(channel)}
                        disabled={loading}
                      >
                        Редактировать
                      </button>
                      <button
                        className="button button-danger channel-card-mobile__button"
                        onClick={() => handleDelete(channel.id)}
                        disabled={loading}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        </div>
      </div>
    </>
  )
}

export default ChannelSettings
