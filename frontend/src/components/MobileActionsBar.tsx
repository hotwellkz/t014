import React from 'react'

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
  return (
    <div className={`mobile-actions-bar ${className}`}>
      <div className="mobile-actions-bar__container">
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            className={`mobile-actions-bar__button mobile-actions-bar__button--${button.variant || 'secondary'}`}
            onClick={button.onClick}
            disabled={button.disabled}
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
}

export default MobileActionsBar
