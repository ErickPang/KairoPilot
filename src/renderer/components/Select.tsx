import React, { useState, useRef, useEffect } from 'react';
import { IconChevronDown, IconCheck } from './Icons';

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom';
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  dropdownTitle?: string;
  size?: 'sm' | 'md';
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  disabled = false,
  placement = 'bottom',
  icon,
  className = '',
  style = {},
  dropdownTitle,
  size = 'md'
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div 
      className={`custom-select ${className}`} 
      style={style}
      ref={containerRef}
    >
      <div 
        className={`custom-select-trigger ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} custom-select-trigger-${size}`}
        onClick={toggleDropdown}
      >
        <div className="custom-select-trigger-content">
          {icon && <span className="custom-select-trigger-icon">{icon}</span>}
          {selectedOption?.icon && !icon && <span className="custom-select-trigger-icon">{selectedOption.icon}</span>}
          <span className={`custom-select-trigger-label ${selectedOption ? 'has-value' : ''}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <IconChevronDown size={16} className={`custom-select-chevron ${isOpen ? 'is-open' : ''}`} />
      </div>

      {isOpen && (
        <div className={`custom-select-dropdown custom-select-dropdown-${placement}`}>
          {dropdownTitle && (
            <div className="custom-select-dropdown-title">
              {dropdownTitle}
            </div>
          )}
          <div className="custom-select-options">
            {options.map(option => (
              <div 
                key={option.value}
                className={`custom-select-option ${option.value === value ? 'is-selected' : ''}`}
                onClick={() => handleSelect(option.value)}
              >
                <div className="custom-select-option-check">
                  {option.value === value && <IconCheck size={16} className="custom-select-option-check-icon" />}
                </div>
                <div className="custom-select-option-copy">
                  <div className="custom-select-option-label-row">
                    {option.icon && <span className="custom-select-option-icon">{option.icon}</span>}
                    <span className={`custom-select-option-label ${option.value === value ? 'is-selected' : ''}`}>
                      {option.label}
                    </span>
                  </div>
                  {option.description && (
                    <span className="custom-select-option-description">
                      {option.description}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {options.length === 0 && (
              <div className="custom-select-empty">
                No options available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
