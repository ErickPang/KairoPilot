import { 
  MessageSquare, 
  Settings, 
  Shield, 
  User, 
  Bot, 
  Wrench, 
  Send, 
  Trash2, 
  Edit2, 
  Plus, 
  X, 
  RefreshCw, 
  Folder,
  Cpu,
  ArrowLeft,
  Check,
  Terminal,
  ChevronDown,
  Puzzle
} from 'lucide-react';
import { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  [key: string]: any;
}

export const IconArrowLeft = ({ size = 24, className = '', ...props }: IconProps) => (
  <ArrowLeft size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCheck = ({ size = 24, className = '', ...props }: IconProps) => (
  <Check size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconChevronDown = ({ size = 24, className = '', ...props }: IconProps) => (
  <ChevronDown size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconTerminal = ({ size = 24, className = '', ...props }: IconProps) => (
  <Terminal size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconChat = ({ size = 24, className = '', ...props }: IconProps) => (
  <MessageSquare size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconCpu = ({ size = 24, className = '', ...props }: IconProps) => (
  <Cpu size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconSettings = ({ size = 24, className = '', ...props }: IconProps) => (
  <Settings size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconShield = ({ size = 24, className = '', ...props }: IconProps) => (
  <Shield size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconUser = ({ size = 24, className = '', ...props }: IconProps) => (
  <User size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconBot = ({ size = 24, className = '', ...props }: IconProps) => (
  <Bot size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconTool = ({ size = 24, className = '', ...props }: IconProps) => (
  <Wrench size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconSend = ({ size = 24, className = '', ...props }: IconProps) => (
  <Send size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconTrash = ({ size = 24, className = '', ...props }: IconProps) => (
  <Trash2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconEdit = ({ size = 24, className = '', ...props }: IconProps) => (
  <Edit2 size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconPlus = ({ size = 24, className = '', ...props }: IconProps) => (
  <Plus size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconX = ({ size = 24, className = '', ...props }: IconProps) => (
  <X size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconRefresh = ({ size = 24, className = '', ...props }: IconProps) => (
  <RefreshCw size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconFolder = ({ size = 24, className = '', ...props }: IconProps) => (
  <Folder size={size} className={className} strokeWidth={1.5} {...props} />
);

export const IconPlugin = ({ size = 24, className = '', ...props }: IconProps) => (
  <Puzzle size={size} className={className} strokeWidth={1.5} {...props} />
);
