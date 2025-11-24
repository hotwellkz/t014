import React from 'react'
import { createPortal } from 'react-dom'

interface ActionButton {
  id: string
  icon: string
  text: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  loading?: boolean
}

interface MobileActionsBarProps {
  buttons: ActionButton[]
  className?: string
}

const MobileActionsBar: React.FC<MobileActionsBarProps> = ({
  buttons,
  className = ''
}) => {
  // Используем Portal для рендеринга вне иерархии DOM
  // Это гарантирует, что position: fixed будет работать корректно
  const content = (
    <div className={`mobile-actions-bar ${className}`}>
      <div className="mobile-actions-bar__container">
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            className={`mobile-actions-bar__button mobile-actions-bar__button--${button.variant || 'secondary'}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!button.disabled && button.onClick) {
                button.onClick()
              }
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onTouchStart={(e) => {
              // Предотвращаем всплытие событий на touch-устройствах
              e.stopPropagation()
            }}
            onTouchEnd={(e) => {
              e.stopPropagation()
            }}
            disabled={button.disabled}
            aria-label={button.text}
          >
            <span className="mobile-actions-bar__icon">
              {button.loading ? '⏳' : button.icon}
            </span>
            <span className="mobile-actions-bar__text">
              {button.loading ? 'Загрузка...' : button.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  // Рендерим через Portal в document.body для гарантированного фиксированного позиционирования
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body)
  }
  
  return content
}

export default MobileActionsBar
