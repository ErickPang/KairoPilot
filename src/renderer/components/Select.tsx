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

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    width: 'max-content',
    minWidth: '100%',
    background: 'var(--sidebar-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 50,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  if (placement === 'top') {
    dropdownStyle.bottom = '100%';
    dropdownStyle.marginBottom = '8px';
  } else {
    dropdownStyle.top = '100%';
    dropdownStyle.marginTop = '8px';
  }

  return (
    <div 
      className={`custom-select ${className}`} 
      style={{ position: 'relative', display: 'inline-block', ...style }}
      ref={containerRef}
    >
      <div 
        onClick={toggleDropdown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--input-bg)',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--input-border)',
          borderRadius: 'var(--radius-md)',
          padding: size === 'sm' ? '4px 10px' : '8px 12px',
          fontSize: size === 'sm' ? '0.8rem' : '0.9rem',
          color: 'var(--foreground)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          opacity: disabled ? 0.7 : 1,
          transition: 'all 0.2s ease',
          minHeight: size === 'sm' ? '28px' : '40px',
          boxShadow: isOpen ? '0 0 0 2px var(--ring)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          {icon && <span style={{ marginRight: '8px', display: 'flex', alignItems: 'center' }}>{icon}</span>}
          {selectedOption?.icon && !icon && <span style={{ marginRight: '8px', display: 'flex', alignItems: 'center' }}>{selectedOption.icon}</span>}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <IconChevronDown 
          size={16} 
          style={{ 
            color: 'var(--muted-fg)', 
            marginLeft: '8px',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }} 
        />
      </div>

      {isOpen && (
        <div style={dropdownStyle}>
          {dropdownTitle && (
            <div style={{ 
              padding: '8px 12px', 
              fontSize: '0.75rem', 
              fontWeight: 600, 
              color: 'var(--muted-fg)',
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--background)'
            }}>
              {dropdownTitle}
            </div>
          )}
          <div style={{ maxHeight: '250px', overflowY: 'auto', padding: '4px' }}>
            {options.map(option => (
              <div 
                key={option.value}
                onClick={() => handleSelect(option.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  color: 'var(--foreground)',
                  transition: 'background-color 0.2s ease',
                  backgroundColor: option.value === value ? 'var(--sidebar-accent)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (option.value !== value) {
                    e.currentTarget.style.backgroundColor = 'var(--sidebar-accent-hover, var(--sidebar-accent))';
                  }
                }}
                onMouseLeave={(e) => {
                  if (option.value !== value) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{ width: '24px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  {option.value === value && <IconCheck size={16} style={{ color: 'var(--primary)' }} />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {option.icon && <span style={{ marginRight: '6px', display: 'flex', alignItems: 'center' }}>{option.icon}</span>}
                    <span style={{ fontWeight: option.value === value ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {option.label}
                    </span>
                  </div>
                  {option.description && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted-fg)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {option.description}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {options.length === 0 && (
              <div style={{ padding: '12px', fontSize: '0.85rem', color: 'var(--muted-fg)', textAlign: 'center' }}>
                No options available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
